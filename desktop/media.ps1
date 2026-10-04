# FurrBox: what is playing right now (Spotify, YouTube in the browser, any player that shows up in
# the Windows media flyout) - read through Windows' own media controls, no sign-in needed.
#   media.ps1 watch              prints one JSON line whenever something changes (and every 15 s)
#   media.ps1 toggle|next|prev   controls the current player
param([string]$Action = "watch")

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait(5000) | Out-Null
  $task.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Current() {
  $session = $manager.GetCurrentSession()
  if (-not $session) { return @{ playing = $false; title = ""; artist = ""; app = "" } }
  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
  @{ playing = ($status -eq "Playing"); title = [string]$props.Title; artist = [string]$props.Artist; app = [string]$session.SourceAppUserModelId }
}

if ($Action -eq "watch") {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $last = ""
  $ticks = 0
  while ($true) {
    try { $json = (Current | ConvertTo-Json -Compress) } catch { $json = '{"playing":false,"title":"","artist":"","app":""}' }
    if ($json -ne $last -or $ticks -ge 5) {
      [Console]::Out.WriteLine($json)
      $last = $json
      $ticks = 0
    }
    $ticks += 1
    Start-Sleep -Seconds 3
  }
} else {
  $session = $manager.GetCurrentSession()
  if ($session) {
    $op = switch ($Action) {
      "toggle" { $session.TryTogglePlayPauseAsync() }
      "next" { $session.TrySkipNextAsync() }
      "prev" { $session.TrySkipPreviousAsync() }
    }
    if ($op) { Await $op ([bool]) | Out-Null }
  }
}
