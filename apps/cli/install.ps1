# Installs or upgrades the Spectron CLI on Windows (PowerShell 5.1 or 7):
#
#   irm https://app.spectron.dev/cli/install.ps1 | iex
#
# The Spectron server fills in its own address and the CLI's checksum when it
# serves this file, so the CLI signs in to that server by default and a
# damaged download is refused. Needs Node.js 22 or later.
#
# Installs to %LOCALAPPDATA%\Programs\spectron, with a spectron.cmd launcher
# in its bin folder, which is added to your user PATH. SPECTRON_INSTALL_DIR
# changes the location; SPECTRON_NO_MODIFY_PATH=1 leaves PATH alone.
#
# Everything is inside one script block, run on the last line, so a download
# that is cut short is a parse error and runs nothing. Failures throw rather
# than exit, which would close the window `iex` runs in.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Native commands report through $LASTEXITCODE here, even if the caller
  # turned on PowerShell 7.4's error-on-exit-code. (Scoped to this block.)
  $PSNativeCommandUseErrorActionPreference = $false
  $server = __SPECTRON_SERVER__
  $checksum = '__SPECTRON_SHA256__'

  $onWindows = $env:OS -eq 'Windows_NT'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'The Spectron CLI needs Node.js 22 or later. Install it from https://nodejs.org, then run this again.'
  }
  # Ask node the way the launcher will find it: on Windows through cmd, from
  # PATH and never the current folder (a PowerShell alias doesn't count).
  # The last line only, and checked: a version manager's shim may print more.
  $askNode = {
    param($expression)
    # Local to this block: on 5.1, stderr from a native command (a shim's or
    # NODE_OPTIONS warning) would otherwise end the install under 'Stop'.
    $ErrorActionPreference = 'Continue'
    if (-not $onWindows) { return "$(& node -p $expression 2>$null | Select-Object -Last 1)".Trim() }
    $saved = $env:NoDefaultCurrentDirectoryInExePath
    $env:NoDefaultCurrentDirectoryInExePath = '1'
    try { "$(& cmd.exe /d /c "node -p $expression" 2>$null | Select-Object -Last 1)".Trim() }
    finally { $env:NoDefaultCurrentDirectoryInExePath = $saved }
  }
  $nodeVersion = & $askNode 'process.versions.node'
  # Percent-encoded so it survives the console's code page (C:\Users\José\…).
  $nodePath = [Uri]::UnescapeDataString((& $askNode 'encodeURIComponent(process.execPath)'))
  if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$' -or -not $nodePath) {
    throw "Couldn't run node from PATH to check its version (it printed '$nodeVersion'). Check that Node.js is installed and on PATH, then run this again."
  }
  if ([int]($nodeVersion.Split('.')[0]) -lt 22) {
    throw "The Spectron CLI needs Node.js 22 or later, and this is v$nodeVersion. Upgrade Node.js, then run this again."
  }

  $installDir = $env:SPECTRON_INSTALL_DIR
  if (-not $installDir) {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA isn''t set. Set SPECTRON_INSTALL_DIR to choose where to install.' }
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\spectron'
  }
  # Relative to the shell's current file system location, not the process's
  # start directory (nor the registry, if the shell is parked in HKCU:).
  if (-not [IO.Path]::IsPathRooted($installDir)) {
    $installDir = Join-Path (Get-Location -PSProvider FileSystem).ProviderPath $installDir
  }
  $installDir = [IO.Path]::GetFullPath($installDir)
  $binDir = Join-Path $installDir 'bin'
  $target = Join-Path $installDir 'spectron.mjs'
  $meta = Join-Path $installDir 'install.json'
  $launcher = Join-Path $binDir 'spectron.cmd'
  # .NET, so [ and ] in a path are characters, not wildcards.
  [IO.Directory]::CreateDirectory($binDir) | Out-Null
  foreach ($path in @($target, $meta, $launcher)) {
    if (Test-Path -LiteralPath $path -PathType Container) {
      throw "$path is a directory. Remove it, or choose another location with SPECTRON_INSTALL_DIR."
    }
  }

  # One install at a time per folder: held until the end, then removed.
  $lockPath = Join-Path $installDir '.install.lock'
  try {
    $lock = New-Object IO.FileStream ($lockPath, 'OpenOrCreate', 'ReadWrite', 'None', 1, 'DeleteOnClose')
  } catch {
    throw "Another install into $installDir is running. Wait for it to finish, then run this again."
  }
  # Staged in a folder of its own and checked before replacing anything, so a
  # failure at any step leaves a working install as it was.
  $stage = Join-Path $installDir ('.staging-' + [Guid]::NewGuid().ToString('N'))
  try {
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    Write-Host "Downloading the Spectron CLI from $server"
    $part = Join-Path $stage 'spectron.mjs'
    # Windows PowerShell 5.1 on an older .NET may not offer TLS 1.2. Add it only
    # then (SystemDefault, 0, lets the OS choose), and only for this download.
    $protocols = [Net.ServicePointManager]::SecurityProtocol
    try {
      if ([int]$protocols -ne 0 -and -not ($protocols -band [Net.SecurityProtocolType]::Tls12)) {
        [Net.ServicePointManager]::SecurityProtocol = $protocols -bor [Net.SecurityProtocolType]::Tls12
      }
      # No redirects: the address is exactly the server that served this.
      # The system proxy applies, as it did for this script.
      $web = @{ Uri = "$server/cli/spectron.mjs"; UseBasicParsing = $true; MaximumRedirection = 0; TimeoutSec = 120 }
      # PowerShell 7.4+: -TimeoutSec stops at the headers; this bounds the body too.
      if ((Get-Command Invoke-WebRequest).Parameters.ContainsKey('OperationTimeoutSeconds')) { $web.OperationTimeoutSeconds = 120 }
      $response = Invoke-WebRequest @web
      # The raw bytes, written with .NET: 5.1's -OutFile reads [ ] in a path as wildcards.
      [IO.File]::WriteAllBytes($part, $response.RawContentStream.ToArray())
    } catch {
      throw "Couldn't download $server/cli/spectron.mjs: $($_.Exception.Message)"
    } finally {
      [Net.ServicePointManager]::SecurityProtocol = $protocols
    }
    # .NET rather than Get-FileHash: 5.1 loads that from a module file, which a
    # PSModulePath inherited from PowerShell 7 hides.
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($part)
    try { $hash = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally { $stream.Dispose(); $sha256.Dispose() }
    if ($hash -ne $checksum) {
      throw 'The download doesn''t match its checksum, so nothing was installed. Run the install command again.'
    }
    $ErrorActionPreference = 'Continue'
    $version = "$(& $nodePath $part --version 2>$null | Select-Object -Last 1)".Trim()
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0 -or -not $version) {
      throw "The downloaded CLI doesn't run with this Node.js (v$nodeVersion), so nothing was installed."
    }
    # The CLI reads install.json beside itself: auth login signs in here unless told otherwise.
    # WriteAllText writes UTF-8 without a byte-order mark, which JSON.parse needs.
    [IO.File]::WriteAllText((Join-Path $stage 'install.json'), (ConvertTo-Json @{ url = $server } -Compress) + "`n")
    # Finds node on PATH at run time, never in the current folder (where cmd
    # looks first), and passes every argument through.
    [IO.File]::WriteAllText((Join-Path $stage 'spectron.cmd'), (@(
      '@echo off'
      'setlocal DisableDelayedExpansion'
      'set NoDefaultCurrentDirectoryInExePath=1'
      'node "%~dp0..\spectron.mjs" %*'
    ) -join "`r`n") + "`r`n")

    # The CLI, install.json and the launcher change together: each live file
    # is moved aside, then replaced, with .NET (Move-Item -Force deletes the
    # target first). If any step fails (a file in use), every step is undone
    # in reverse, so a first install leaves nothing behind.
    $swaps = @(
      @{ New = $part; Live = $target; Old = (Join-Path $stage 'previous.mjs') },
      @{ New = (Join-Path $stage 'install.json'); Live = $meta; Old = (Join-Path $stage 'previous.json') },
      @{ New = (Join-Path $stage 'spectron.cmd'); Live = $launcher; Old = (Join-Path $stage 'previous.cmd') }
    )
    try {
      foreach ($swap in $swaps) {
        if ([IO.File]::Exists($swap.Live)) { [IO.File]::Move($swap.Live, $swap.Old); $swap.MovedAside = $true }
        [IO.File]::Move($swap.New, $swap.Live); $swap.Published = $true
      }
    } catch {
      $reason = $_.Exception.Message
      $stranded = @()
      for ($i = $swaps.Count - 1; $i -ge 0; $i--) {
        $swap = $swaps[$i]
        try {
          if ($swap.Published) { [IO.File]::Delete($swap.Live); $swap.Published = $false }
          if ($swap.MovedAside) { [IO.File]::Move($swap.Old, $swap.Live) }
        } catch {
          if ($swap.Published) { $stranded += "delete $($swap.Live)" }
          if ($swap.MovedAside) { $stranded += "move $($swap.Old) to $($swap.Live)" }
        }
      }
      if ($stranded) {
        # Keep the staging folder: it holds the only copies of the previous files.
        $stage = $null
        throw "Couldn't finish installing ($reason), nor undo it. To restore the previous state: $($stranded -join '; ')"
      }
      throw "Couldn't finish installing, so the previous version was kept: $reason"
    }
  } finally {
    if ($stage) { Remove-Item -Recurse -Force -LiteralPath $stage -ErrorAction SilentlyContinue }
    $lock.Dispose()
    # DeleteOnClose isn't honoured everywhere (macOS, Linux).
    Remove-Item -Force -LiteralPath $lockPath -ErrorAction SilentlyContinue
  }

  Write-Host "Installed spectron $version`: $launcher"
  if ($onWindows -and $env:SPECTRON_NO_MODIFY_PATH -ne '1') {
    # Entries may be quoted, use /, or end in \ (kept on a drive root: C:\).
    $normal = {
      param($entry)
      $path = [Environment]::ExpandEnvironmentVariables($entry).Trim().Trim('"').Trim().Replace('/', '\').TrimEnd('\')
      if ($path -match '^[A-Za-z]:$') { $path += '\' }
      $path
    }
    $isBin = { param($entry) (& $normal $entry) -ieq $binDir }
    # First in the user PATH, moved there if it was further down, so an
    # older spectron (an npm install) can't win. Read and written raw,
    # keeping it an expandable string: entries such as %USERPROFILE%\bin
    # must stay unexpanded.
    $key = Get-Item -LiteralPath 'HKCU:\Environment'
    $userPath = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $entries = @($userPath.Split(';') | Where-Object { $_ })
    $wanted = (@($binDir) + @($entries | Where-Object { -not (& $isBin $_) })) -join ';'
    if ($wanted -ne ($entries -join ';')) {
      Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name Path -Type ExpandString -Value $wanted
      # Setting and removing a user variable through .NET tells open programs
      # (Explorer, new terminals) that the environment changed. NullString,
      # because PowerShell 7.5+ turns $null into an empty string here.
      [Environment]::SetEnvironmentVariable('SPECTRON_INSTALL_REFRESH', '1', 'User')
      [Environment]::SetEnvironmentVariable('SPECTRON_INSTALL_REFRESH', [NullString]::Value, 'User')
      Write-Host ''
      Write-Host "Put $binDir first in your user PATH. Open a new terminal to use spectron there."
    }
    # First in this window too, so the next command runs this CLI.
    $env:Path = (@($binDir) + @($env:Path.Split(';') | Where-Object { $_ -and -not (& $isBin $_) })) -join ';'
    # New terminals search the system PATH before the user PATH, so look for
    # spectron the way they will. In this window, an alias or function wins.
    $found = $null
    $search = "$([Environment]::GetEnvironmentVariable('Path', 'Machine'));$wanted".Split(';') | Where-Object { $_ }
    $pathext = $env:PATHEXT
    if (-not $pathext) { $pathext = '.COM;.EXE;.BAT;.CMD' }
    # PowerShell also runs a spectron.ps1 found on PATH.
    $pathext = "$pathext;.PS1"
    foreach ($entry in $search) {
      $folder = & $normal $entry
      # Blank and relative entries ("", " ", "tools") don't name a fixed folder.
      # A pattern, not IsPathRooted, which throws on 5.1 for a malformed entry.
      if ($folder -notmatch '^([A-Za-z]:\\|\\\\)') { continue }
      foreach ($extension in ($pathext.Split(';') | Where-Object { $_ })) {
        # A malformed entry is skipped, as Windows skips it; File.Exists never throws.
        try { $candidate = [IO.Path]::Combine($folder, 'spectron' + $extension) } catch { continue }
        if ([IO.File]::Exists($candidate)) { $found = $candidate; break }
      }
      if ($found) { break }
    }
    if ($found -and $found -ine $launcher) {
      Write-Host ''
      Write-Host "New terminals will run $found, which comes first on PATH, not this install. Remove it (for an npm install: npm uninstall -g @spectron/cli)."
    }
    $here = Get-Command spectron -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($here -and $here.CommandType -ne 'Application') {
      Write-Host ''
      Write-Host "In this window, spectron is a $($here.CommandType.ToString().ToLower()), which runs instead of this install. Remove it, or run $launcher."
    }
  }
  Write-Host ''
  Write-Host 'Next: spectron auth login'
}
