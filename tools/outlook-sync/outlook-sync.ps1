<#
  AI CV Portal - Outlook sync helper (read-only).

  Serves the application tracker on https://ai-cv-portal.vercel.app the mail it needs to
  mark applications Sent and log replies: the Sent Items and Inbox of ONE Outlook account,
  read through classic Outlook on this PC. No Azure, no passwords, no cloud.

  Read-only by design: it never sends, moves, deletes or flags mail. It listens on
  127.0.0.1 only and answers only the portal's own pages (checked by Origin and Host),
  so other websites and other machines cannot read your mail through it.

    GET /health              -> { ok, account, version }
    GET /mail?since=YYYY-MM-DD -> { account, fetchedAt, sent:[...], inbox:[...] }

  Each mail comes back in the shape tracker-mail.js reads (msgId, inReplyTo, references,
  from, to, date, subject, text, autoSubmitted, isReport, isReceipt).

  Run:  powershell -ExecutionPolicy Bypass -File outlook-sync.ps1
  Test: powershell -ExecutionPolicy Bypass -File outlook-sync.ps1 -SelfTest
#>
param(
  [string]$Account = "rassemkadiri@live.de",
  [int]$Port = 47321,
  [int]$MaxPerFolder = 300,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
$Version = "1.0.0"
$AllowedOrigins = @(
  "https://ai-cv-portal.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
)
$AllowedHosts = @("127.0.0.1:$Port", "localhost:$Port")

# MAPI properties read through PropertyAccessor (string forms, "001F" = Unicode).
$P = @{
  MessageId   = "http://schemas.microsoft.com/mapi/proptag/0x1035001F"
  InReplyTo   = "http://schemas.microsoft.com/mapi/proptag/0x1042001F"
  References  = "http://schemas.microsoft.com/mapi/proptag/0x1039001F"
  Headers     = "http://schemas.microsoft.com/mapi/proptag/0x007D001F"
  SenderSmtp  = "http://schemas.microsoft.com/mapi/proptag/0x5D01001F"
  RecipSmtp   = "http://schemas.microsoft.com/mapi/proptag/0x39FE001F"
}

$script:ns = $null
function Get-Store {
  if (-not $script:ns) {
    $script:ns = (New-Object -ComObject Outlook.Application).GetNamespace("MAPI")
  }
  foreach ($s in $script:ns.Stores) {
    if ($s.DisplayName -ieq $Account) { return $s }
  }
  throw "Outlook has no mailbox named '$Account'. Open classic Outlook and add that account."
}

function Get-Prop($pa, $name) {
  try { [string]$pa.GetProperty($P[$name]) } catch { "" }
}

function Get-MessageIds([string]$v) {
  @([regex]::Matches($v, '<[^<>\s]+>') | ForEach-Object { $_.Value.ToLowerInvariant() })
}

function Get-HeaderValue([string]$headers, [string]$name) {
  # Unfolded value of one header line in a raw transport header block.
  $m = [regex]::Match($headers, "(?im)^$([regex]::Escape($name)):[ \t]*(.*(?:\r?\n[ \t]+.*)*)")
  if ($m.Success) { ($m.Groups[1].Value -replace '\r?\n[ \t]+', ' ').Trim() } else { "" }
}

function Convert-Item($it, [string]$dir) {
  $cls = [string]$it.MessageClass
  # Only real mail, bounces (NDR) and read receipts (IPNRN). Meeting requests, tasks and
  # "delivered" receipts (DR) say nothing about how an application is going.
  if ($cls -notmatch '^(IPM\.Note|REPORT\.IPM\.Note\.(NDR|IPNRN))') { return $null }
  $pa = $it.PropertyAccessor
  $headers = Get-Prop $pa "Headers"

  $fromAddr = ""
  $fromName = ""
  try {
    $fromName = [string]$it.SenderName
    $fromAddr = if ([string]$it.SenderEmailType -eq "EX") { Get-Prop $pa "SenderSmtp" } else { [string]$it.SenderEmailAddress }
  } catch {}
  if (-not $fromAddr -and $dir -eq "out") { $fromAddr = $Account }

  $to = @()
  try {
    foreach ($r in $it.Recipients) {
      $a = ""
      try { $a = [string]$r.PropertyAccessor.GetProperty($P["RecipSmtp"]) } catch {}
      if (-not $a) { $a = [string]$r.Address }
      if ($a -match '@') { $to += $a.ToLowerInvariant() }
    }
  } catch {}

  $when = $null
  try { $when = if ($dir -eq "out") { $it.SentOn } else { $it.ReceivedTime } } catch {}
  # Reports have no ReceivedTime; without a date they would sort first and skew the dates.
  if (-not $when) { try { $when = $it.CreationTime } catch {} }
  $date = if ($when) { ([datetime]$when).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } else { "" }

  $refs = Get-Prop $pa "References"
  if (-not $refs) { $refs = Get-HeaderValue $headers "References" }
  $irt = Get-Prop $pa "InReplyTo"
  if (-not $irt) { $irt = Get-HeaderValue $headers "In-Reply-To" }

  $text = ""
  try { $text = [string]$it.Body } catch {}
  if ($text.Length -gt 6000) { $text = $text.Substring(0, 6000) }

  $auto = ($headers -match '(?im)^Auto-Submitted:\s*auto-') -or
          ($headers -match '(?im)^X-Auto(reply|respond)') -or
          ($cls -match 'OofTemplate|AutoReply')

  [ordered]@{
    dir           = $dir
    msgId         = @(Get-MessageIds (Get-Prop $pa "MessageId"))[0]
    inReplyTo     = @(Get-MessageIds $irt)
    references    = @(Get-MessageIds $refs)
    from          = [ordered]@{ name = $fromName; address = $fromAddr.ToLowerInvariant() }
    to            = @($to)
    date          = $date
    subject       = [string]$it.Subject
    text          = $text
    autoSubmitted = [bool]$auto
    isReport      = [bool]($cls -match '^REPORT\.IPM\.Note\.NDR')
    isReceipt     = [bool]($cls -match '^REPORT\.IPM\.Note\.IPNRN')
  }
}

function Get-FolderMail($folder, [datetime]$since, [string]$dir) {
  # DASL with an ISO date avoids the locale-dependent [ReceivedTime] filter syntax.
  $prop = if ($dir -eq "out") { "http://schemas.microsoft.com/mapi/proptag/0x00390040" } else { "urn:schemas:httpmail:datereceived" }
  $filter = "@SQL=""$prop"" >= '" + $since.ToUniversalTime().ToString("yyyy-MM-dd HH:mm") + "'"
  $items = $folder.Items.Restrict($filter)
  $items.Sort($(if ($dir -eq "out") { "[SentOn]" } else { "[ReceivedTime]" }), $true)   # newest first
  $out = New-Object System.Collections.ArrayList
  $it = $items.GetFirst()
  while ($it -and $out.Count -lt $MaxPerFolder) {
    try {
      $m = Convert-Item $it $dir
      if ($m) { [void]$out.Add($m) }
    } catch {}
    $it = $items.GetNext()
  }
  ,$out
}

function Get-Mail([datetime]$since) {
  $store = Get-Store
  [ordered]@{
    account   = $Account
    fetchedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    sent      = Get-FolderMail ($store.GetDefaultFolder(5)) $since "out"
    inbox     = Get-FolderMail ($store.GetDefaultFolder(6)) $since "in"
  }
}

function Parse-Since([string]$v) {
  $d = [datetime]::MinValue
  if ([datetime]::TryParseExact($v, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$d)) { return $d }
  (Get-Date).AddDays(-30)
}

if ($SelfTest) {
  # Prints counts and which fields came back - never the mail itself.
  $r = Get-Mail ((Get-Date).AddDays(-60))
  foreach ($k in "sent", "inbox") {
    $list = $r[$k]
    $withId = @($list | Where-Object { $_.msgId }).Count
    $withFrom = @($list | Where-Object { $_.from.address }).Count
    $withDate = @($list | Where-Object { $_.date }).Count
    "{0,-5} items={1}  msgId={2}  from={3}  date={4}" -f $k, $list.Count, $withId, $withFrom, $withDate
  }
  $json = $r | ConvertTo-Json -Depth 6 -Compress
  "json bytes: " + [Text.Encoding]::UTF8.GetByteCount($json)
  return
}

# ---------- HTTP server ----------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Outlook sync for $Account listening on http://127.0.0.1:$Port (read-only). Ctrl+C to stop."

function Send-Json($ctx, [int]$status, $obj, [string]$origin) {
  $res = $ctx.Response
  $res.StatusCode = $status
  if ($origin) {
    $res.Headers["Access-Control-Allow-Origin"] = $origin
    $res.Headers["Vary"] = "Origin"
  }
  $res.Headers["Cache-Control"] = "no-store"
  $res.ContentType = "application/json; charset=utf-8"
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 6 -Compress))
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $req = $ctx.Request
    $origin = [string]$req.Headers["Origin"]
    $hostHdr = [string]$req.Headers["Host"]
    # Host check blocks DNS-rebinding; Origin check keeps every other website out.
    if ($AllowedHosts -notcontains $hostHdr.ToLowerInvariant() -or ($origin -and $AllowedOrigins -notcontains $origin)) {
      Send-Json $ctx 403 @{ error = "forbidden" } ""
      continue
    }
    if ($req.HttpMethod -eq "OPTIONS") {
      $res = $ctx.Response
      $res.StatusCode = 204
      $res.Headers["Access-Control-Allow-Origin"] = $origin
      $res.Headers["Access-Control-Allow-Methods"] = "GET"
      $res.Headers["Access-Control-Allow-Headers"] = "Content-Type"
      $res.Headers["Access-Control-Allow-Private-Network"] = "true"
      $res.Headers["Access-Control-Max-Age"] = "600"
      $res.Close()
      continue
    }
    if ($req.HttpMethod -ne "GET") { Send-Json $ctx 405 @{ error = "read-only" } $origin; continue }
    switch ($req.Url.AbsolutePath) {
      "/health" { Send-Json $ctx 200 ([ordered]@{ ok = $true; account = $Account; version = $Version }) $origin }
      "/mail" {
        try {
          Send-Json $ctx 200 (Get-Mail (Parse-Since $req.QueryString["since"])) $origin
        } catch {
          $script:ns = $null   # Outlook restarted or closed: reconnect on the next call
          Send-Json $ctx 503 @{ error = "outlook"; message = $_.Exception.Message } $origin
        }
      }
      default { Send-Json $ctx 404 @{ error = "not found" } $origin }
    }
  } catch {
    try { $ctx.Response.Abort() } catch {}
  }
}
