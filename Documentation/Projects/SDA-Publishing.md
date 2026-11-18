# SDA publication inputs

Website source is [SDA-Standalone](../../Static/SDA-Standalone/README.md); Function source is [SDA.Contact](../../Functions/SDA.Contact/README.md). The public form remains disabled, with blank endpoint and challenge site key. Provider, sender, authentication, domain aliases and activation remain unresolved. Git publication does not deploy either host, change DNS or send mail.

Terraform owns infrastructure/DNS and deployment bindings. Approved subscription: `b7690041-454b-472b-b340-3d8dde115103`; new group: `SDA-Websites-Prod`; SWA `sda-website` Standard in **West US 2**; Function `sda-website-functions` Linux Node24/Flex512/no always-ready instances in **West US 3**. Existing Bicep is a reviewed local reference, not an instruction to apply competing resources. Domain claims in historical source documentation are capture-era context; the final alias/authentication decisions must be resolved with the infrastructure owner before activation.

## Website artifact

From the repository root, with Node installed:

```powershell
node Scripts/Publish-SdaWebsite.mjs
if ($LASTEXITCODE -ne 0) { throw 'Website packaging failed' }
```

Deploy only the **contents of `dist/website`** to the SWA site root. The packager copies exactly429 files:42 pages,384 resource assets, the two browser handlers and `staticwebapp.config.json`. It verifies hashes, explicit rewrite targets and absence of the public recipient/email fallback. It refuses existing output; retain any failed artifact and use a new `--out dist/fresh-name` for a deliberate rerun. Never publish the whole source directory: development manifests, source tools, documentation, screenshots and evidence are excluded from the host artifact. Runtime needs no build, PHP, database or CMS. No activation/deployment command is supplied here.

## Function production staging

Use Node24 and npm from the deployment build environment, from the repository root. This procedure creates a fresh staging directory and installs only locked production dependencies; it does not deploy or configure the Function:

```powershell
$nodeMajor = node -p "process.versions.node.split('.')[0]"
if ($LASTEXITCODE -ne 0 -or $nodeMajor -ne '24') { throw 'Node24 required' }
npm --version
if ($LASTEXITCODE -ne 0) { throw 'npm unavailable' }
$repoRoot = (Get-Location).Path
$functionSource = Join-Path $repoRoot 'Functions/SDA.Contact'
$functionStage = Join-Path $repoRoot 'dist/functions'
if (Test-Path -LiteralPath $functionStage) { throw 'Function staging already exists' }
New-Item -ItemType Directory -Path $functionStage -Force | Out-Null
foreach ($name in @('host.json', 'package.json', 'package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $functionSource $name) -Destination $functionStage
}
Copy-Item -LiteralPath (Join-Path $functionSource 'src') -Destination $functionStage -Recurse
npm ci --omit=dev --prefix $functionStage
if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed; retain staging for inspection' }
```

Deployment package root is **`dist/functions` contents**, with host.json, package.json/lock, src and production node_modules directly at root. Terraform's deployment workflow owns packaging/upload. If it creates a ZIP, ZIP these contents rather than their parent folder; use a fresh destination and fail on an existing ZIP. Exclude local.settings.json, tests, docs, infra, .tools, .azurite, evidence and development Node/Azurite dependencies. JavaScript requires no transpilation. Required app settings, managed identity/storage roles, challenge secret, approved origins, telemetry authentication and provider remain infrastructure/activation prerequisites. Keep `MAIL_ENABLED=false`; no production mail adapter currently exists.

## Source verification and evidence limits

Pinned source dependencies/locks and tests are committed. `npm ci` in each source package installs its development checks; Function core tests run with Node24 via `npm test`. Historical browser/check scripts often require the external Legacy capture, installed Edge and retained local evidence paths. Historical evidence, screenshots, preimages and downloaded runtimes are retained locally and excluded from Git and both host artifacts. A clean clone contains deployable runtime/source inputs, not a complete historical capture archive. Production staging above is a command contract; it has not been run or deployed as part of Git publication.

The publication commit is the authoritative source snapshot. `main`, `publish-website` and literal `publich-functions` are intended to identify that same initial commit; final ref identities are reported after ordinary Git push verification. No GitHub workflow or host deployment is created by this task.
