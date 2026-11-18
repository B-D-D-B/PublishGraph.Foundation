# SDA publication inputs

Website source is [SDA-Standalone](../../Static/SDA-Standalone/README.md); Function source is [SDA.Contact](../../Functions/SDA.Contact/README.md). The public form remains disabled, with exact same-origin `/api/contact` and a blank challenge site key. Titan SMTP with sender contact@bddb.io and the linked-endpoint frontend have independent local acceptance. Production authentication/backend linking, challenge configuration, activation and delivery remain separate infrastructure/owner gates. Git publication does not deploy either host, change DNS or send mail.

Terraform owns infrastructure/DNS and deployment bindings. Approved subscription: `b7690041-454b-472b-b340-3d8dde115103`; new group: `SDA-Websites-Prod`; SWA `sda-website` Standard in **West US 2**; Function `sda-website-functions` Linux Node24/Flex512/no always-ready instances in **West US 3**. Existing Bicep is a reviewed local reference, not an instruction to apply competing resources. The owner selected `silicondreamartists.com` (single n) and its www alias alongside `sda.studio` and its www alias; infrastructure owns live domain/certificate evidence and the final auth/link contract. Historical capture-domain descriptions do not authorize DNS changes.

## Website artifact

From the repository root, with Node installed:

```powershell
node Scripts/Publish-SdaWebsite.mjs
if ($LASTEXITCODE -ne 0) { throw 'Website packaging failed' }
```

Deploy only the **contents of `dist/website`** to the SWA site root. The packager copies exactly429 files:42 pages,384 resource assets, the two browser handlers and `staticwebapp.config.json`. It verifies hashes, native-equivalent route uniqueness, exact catalog rewrite targets and absence of the public recipient/email fallback. The 43 explicit default-index rules preserve canonical and trailing-slash URLs without redirects. Local preview and official CLI matcher checks do not establish native-client or Azure deployment acceptance; the infrastructure owner must review the exact changed source and validate native upload/routes before DNS cutover. It refuses existing output; retain any failed artifact and use a new `--out dist/fresh-name` for a deliberate rerun. Never publish the whole source directory: development manifests, source tools, documentation, screenshots and evidence are excluded from the host artifact. Runtime needs no build, PHP, database or CMS. No activation/deployment command is supplied here.

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

Deployment package root is **`dist/functions` contents**, with host.json, package.json/lock, src and production node_modules directly at root. Terraform's deployment workflow owns packaging/upload. If it creates a ZIP, ZIP these contents rather than their parent folder; use a fresh destination and fail on an existing ZIP. Exclude application-root local.settings.json, tests, docs, infra, .tools, .azurite and evidence, and omit development-only Node/Azurite/SMTP-fixture packages. Keep complete locked production dependency packages, including their own licenses, metadata and bundled documentation. JavaScript requires no transpilation. Required app settings, managed identity/storage roles, challenge secret, approved origins, telemetry authentication and provider remain infrastructure/activation prerequisites. Keep `MAIL_ENABLED=false`; the production dependency set includes the locally accepted Titan SMTP adapter. It fixes smtp.titan.email:465 with verified implicit TLS and uses server-only sender/account/password settings; no credentials or provider connection are part of staging.

## Source verification and evidence limits

Pinned source dependencies/locks and tests are committed. `npm ci` in each source package installs its development checks; Function core tests run with Node24 via `npm test`. Historical browser/check scripts often require the external Legacy capture, installed Edge and retained local evidence paths. Historical evidence, screenshots, preimages and downloaded runtimes are retained locally and excluded from Git and both host artifacts. A clean clone contains deployable runtime/source inputs, not a complete historical capture archive. The publication receipt records actual Node24 production staging, lock/tool identities, a complete file/byte/SHA256 manifest, dependency loading and local registration checks. It also binds a fresh website artifact. These local observations do not establish Azure deployment or mail delivery. Infrastructure must consume the exact accepted commit and receipt-bound artifact; any rebuild needs its own identity verification.

The publication commit is the authoritative source snapshot. `main`, `publish-website` and literal `publish-functions` identify the accepted publication commit after ordinary atomic push verification. The historical misspelled branch is unused and is neither updated nor deleted. The final receipt binds exact source commit/tree/parent, authoritative refs, website429-file identity and production Function staging identity. No GitHub workflow or host deployment is created by this task.
