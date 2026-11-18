# SDA-GIT-PUBLISH-06 contact publication continuation

Proposed execution only; exact independent D1–D8 READY is required. This continues Git06, preserves its history, and does not reopen the accepted local Titan/endpoint functions. SP-01/SP-02 and the worker/reviewer cycle govern safeguards, correction, records and gates. Normal track: integrate established accepted contracts without changing SMTP, authentication or cloud semantics.

Worker: fresh isolated contact_publish_worker, requested/configured guarantee gpt-6.1-sol/medium. Reviewer: distinct coordinator-assigned gpt-6-astra/medium. Host-observed runtime model telemetry is unavailable; requested settings are not measured metadata. Coordinator alone writes the existing Working record. Worker owns this proposal and, after READY, the new isolated checkout and its scoped publication effects.

## Fixed inputs and outcome

- Published parent: `03122b07398a7f2c29b47824e793f02468ce0314` (route08), observed at origin main/publish-website/publish-functions. Root checkout remains on its existing dirty older main; never switch, reset, stash, clean, stage or update it.
- Accepted Titan manifest: `Static/SDA-Standalone/output-manifest-contact-titan-01.json`, SHA256 `252588CCD1BCB6069C5ED17E08970C3CDB11F47771881E47511234BB5034E908`.
- Accepted endpoint manifest: `Static/SDA-Standalone/output-manifest-contact-linked-endpoint.json`, SHA256 `42085DDDC9B9650405950D963910944134964741023C992BCD775EF88F2C4D31`. Working records independent local PASS for both manifests. Revalidate exact manifest hashes and every selected file against its bound entry before copying; digest mismatch stops, never adopts new bytes.
- Deliver one independently accepted source commit descended directly from the parent; fresh website artifact; actual production Function staging with file/hash identity; ordinary atomic publication to main/publish-website/publish-functions; final ref and artifact receipt for infrastructure owner. Git publication and local package loading do not establish Azure deployment, auth/link correctness or delivery.
- Keep website disabled, exact same-origin `/api/contact`, blank site key and disabled submit button. Function `MAIL_ENABLED` remains false/default false. No secrets acquired, provider connection, outgoing message, cloud command, DNS change, deployment, auth selection or activation.

## Owned integration boundary

1. Create a unique sibling worktree/branch from the exact parent only after READY and coordinator grants sole Git/ref writer lease. Capture root tracked diff/index/status and all dirty/untracked file bytes (excluding attributed coordinator Working writes and generated dependency/cache directories); retain hash bindings and original bytes for owned preimages. Capture remote refs including historical typo before mutation. Shared index/ref/worktree operations require the explicit coordinator exclusion lease held through verification; competing writers or missing exclusion stop those operations.
2. Copy these accepted endpoint-manifest entries exactly: the two existing contact addenda; Functions/SDA.Contact/local.settings.example.json, package.json, package-lock.json, src/dependencies.js, src/index.js, src/titan-smtp.js, test/titan-smtp.test.js, test/browser.cjs, test/browser-linked-endpoint.cjs; Static/SDA-Standalone/assets/contact.js and index.php/contact.html. Titan manifest must agree on shared entries. All other Function runtime files come from the accepted parent and are guarded. No historical tools, evidence bulk, screenshots, caches, unavailable assets, workspace settings, root AGENTS or unrelated C# changes enter the commit.
3. Reconcile only Documentation/Projects/SDA-Publishing.md, Functions/SDA.Contact/README.md and Static/SDA-Standalone/README.md against accepted contact docs and route08 parent. Preserve route08 43 explicit index rules and 429-file artifact contract. Correct obsolete blank-endpoint/no-adapter/unresolved-sender statements to disabled exact `/api/contact` and locally accepted Titan adapter. State established infrastructure facts only with attributed coordinator evidence; retain unresolved auth/challenge/activation/delivery prerequisites and local-versus-cloud limits. Correct future ref contract to literal publish-functions; retain historical typo history and do not mutate/delete its ref. Do not copy accepted old docs wholesale over route08 additions.
4. Preserve staticwebapp.config.json, tools/swa-route-contract.cjs, tools/serve.cjs, Scripts/Publish-SdaWebsite.mjs and all unrelated route08 changes exactly. Update only Scripts/Test-SdaWebsiteRoutes.mjs's stale disabled blank-endpoint assertion/name to exact `/api/contact`; this is the required affected consumer adjustment. Do not regenerate routes/pages/catalogs.
5. Reuse existing production staging command contract rather than introduce a redundant script. Its documented fresh dist/functions procedure copies host.json, package.json/lock and src only and runs Node24 `npm ci --omit=dev`; update its stale adapter/staging claims after actual execution. Stage locally to that fresh directory; if occupied, retain it and choose a fresh dist/functions-contact-git06-<unique> path with receipt/documented substitution. ZIP creation is not required: infrastructure owns upload/archive creation.

## Ordered execution and acceptance oracles

A. Preflight exact inputs, exclusion lease and worktree absence. Bind approved preimages from parent plus selected manifest entries mechanically. Before each ordinary patch, revalidate owned path/preimage, retain bytes, use matching context, verify intended postimage and untouched regions. Protected/immutable writes follow SP-01 actual exclusion. Every evidence filename is fresh/write-once. Evidence under the new worktree's ignored dist/contact-publication-06 has a single consumer: independent review/infrastructure handoff; do not commit generated evidence or dependency trees.

B. Install pinned dependencies in the isolated worktree. Default shell Node observed v22.9.0 is unsuitable for runtime acceptance. Obtain Node24 from the accepted pinned development Node24.22.3 package (existing verified local executable may bootstrap installation). Run npm CLI with that executable/PATH; record executable/version and npm version. `npm ci` only in new worktree package directories, locked packages unchanged. Use Windows Edge/CoreTools/OpenSSL already present; do not install cloud credentials or invoke provider services. If Node24 or required local tooling cannot be established, stop dependent acceptance.

C. Before the route harness, supply its required pinned official CLI independently of the source packages. Reuse only the accepted route08 tooling directory C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation-swa-routes-08/dist/swa-routes-08/official-cli, copied to this new worktree's fresh dist/swa-routes-08/official-cli. First verify accepted route08 aggregate result SHA256 E8902CB23306BBB8F56C2CE0DFF7F3214FAEA9535FEDC1D18188CF4246F26A7A and source lock SHA256 C6503E713664F69249E7FA3CF2E3E19527EA3C1836026AE77FE76023256B941D; record the copied lock's identical identity and lock entry @azure/static-web-apps-cli version2.1.0/integrity exactly as required by the harness. Verify matcher dist/msha/routes-engine/route-processor.js and index helper dist/msha/routes-engine/rules/routes.js hashes against that accepted result's official evidence (SHA256 73bfe4d6a5e67d4825a2134ea07a5ed9fe2005f801c118cb1a1dade0832703bd and cf09d2db89952ed39ba1a5bbd674e2c5a690da84b517376dac875a525936d19b). Hash-bind all copied tooling files before/after transfer and retain provenance receipt; obtain coordinator exclusion for that accepted tooling source while copying. These are ignored test tools only: no product package/lock changes, executable install scripts, replacement self-check or CLI/deployment invocation. Missing tooling, changed lock/matcher/helper, copy mismatch or unavailable exclusion stops the dependent route gate; no new install fallback is assumed.

Run under Node24, preserving complete logs and reporting final counts/failing assertions:

```powershell
# Working directory is the isolated checkout; Node24 is first on PATH.
npm ci --prefix Functions/SDA.Contact
npm ci --prefix Static/SDA-Standalone
npm test --prefix Functions/SDA.Contact
npm run test:smtp --prefix Functions/SDA.Contact
node Scripts/Publish-SdaWebsite.mjs --self-test
node Scripts/Publish-SdaWebsite.mjs --out dist/website
# Route harness creates its own fresh immutable receipt directory.
node Scripts/Test-SdaWebsiteRoutes.mjs contact-git06 dist/website
node Functions/SDA.Contact/test/browser.cjs
node Functions/SDA.Contact/test/browser-linked-endpoint.cjs
```

Create the browser harnesses' expected empty Static/SDA-Standalone/evidence/contact-linked-endpoint directory in this new worktree only. Harnesses mock challenge/API and block production egress; their local synthetic contact tests must pass and disabled source must remain byte-identical to accepted inputs. No tests operate against production. Route harness parent dist/swa-routes-08 directory may be created empty as required; reuse no old result. Route oracle: 43 rules remain exactly parent bytes, route resolution/targets/preview/browser/artifact checks pass, only contact HTML+handler differ in website runtime against parent. Require exactly429 allowlisted files, copied hashes equal source, no public recipient/mailto fallback, documentation/tests/credentials absent. Reuse unchanged accepted storage/Titan evidence only when inputs/config/dependencies remain exact; core and SMTP affected tests run anew, no full historic legacy-capture campaign.

D. Execute the documented fresh production staging using Node24 and npm ci --omit=dev. Record lock hash, npm result, `npm ls --omit=dev --all` and explicit absence of dev packages (azurite, node, smtp-server) in stage. Recursively bind every staged relative file/bytes/SHA256 and tool/platform metadata; verify root host.json, package.json/lock, src/index.js and all source files are exact, production Nodemailer/Azure dependencies load, and no local settings/tests/docs/evidence/tools are staged. Generate a deterministic aggregate identity from the manifest bytes, without claiming cross-platform npm reproducibility or archive identity. Static website manifest similarly binds exact429 files and bytes, its own path/hash and source provenance.

E. Verify actual Node24 production dependency loading and Azure registration from the staged source with MAIL_ENABLED=false and no provider/challenge/storage secrets; capture registered route/method/anonymous-auth metadata using the installed Azure library's local registration mechanism and inspect disabled handler behavior. Reuse accepted Titan disabled actual-host evidence only after verifying exact backend/configuration and tool provenance remain applicable. A fresh loopback-only host check may strengthen evidence using the root's accepted Functions/SDA.Contact/.tools/node_modules/azure-functions-core-tools/bin/func.exe (4.16.1), whose exact executable/package hashes must be captured; global older CoreTools is not Node24-compatible and must not be substituted. Tooling remains external to production stage. For a fresh host check record discovered `/api/contact` and disabled POST503, OPTIONS/origin/method behavior per unchanged accepted handler contract; assert no challenge/storage/provider use. Retain logs, terminate only owned processes, and report unavailable host prerequisites without claiming new host execution. Stop acceptance if staged registration/loading fails or the exact accepted disabled-host evidence cannot support affected runtime behavior. No production setting is enabled for any smoke check.

F. Check exact scope, all untouched parent bindings and root dirty guards; docs agree with actual staging/source/ref contract; no credential values in changed source/host artifacts/evidence. Freeze source and artifact manifests plus aggregate result with actual commands, failure history, selected evidence reuse, counts, limitations and all identities. Pause writes; independent reviewer applies R1–R8 to the aggregate frozen result. Ordinary supported corrections stay within this READY boundary and retain prior failures; changed scope/semantics/oracle/authority needs affected READY. No worker/coordinator self-awards acceptance.

G. After independent aggregate PASS, explicitly stage only the named source/docs/test/addenda paths (including this addendum) and create one normal commit, no amend/hook bypass. Verify staged blobs and committed tree against accepted normalized source manifest; exact parent and only authorized paths; isolate CRLF normalization explicitly by comparing Git blob bytes and preserving approved working-file identities. Unexpected normalization/content stops commit/publication; ordinary encoding-only repair requires retained preimages, intended unchanged semantics and affected checks. Freeze commit/tree receipt for independent reviewer exact committed-tree PASS before any push.

H. Under sole Git/ref lease, freshly query origin main/publish-website/publish-functions; all must still equal exact parent. If diverged stop publication, never force/rebase/adopt another base. Push the accepted commit with one ordinary `git push --atomic origin <commit>:refs/heads/main <commit>:refs/heads/publish-website <commit>:refs/heads/publish-functions`. No deletion, typo update, root checkout/index update, force or bypass. Query authoritative remote refs after success/uncertain result; never blindly retry. If already all exact accepted commit, record observed outcome; mixed/other state stops. Verify historical typo unchanged and root guards preserved. Freeze final publication receipt and request independent final R1–R8 closure for this same Git06 continuation.

## Failure boundary and handoff

Maintain one coordinator record; preserve all prior STOPPED/findings/accepted closures. Operational recovery follows SP-02: inspect raw error and partial state first. A finite mechanical branch permits only fresh receipt/path argument spelling, missing empty generated parent directories, shell helper-name collision, PATH/Node executable selection and log-output quoting correction in owned out-of-tree orchestration. Confirm no product start/effect for helper repair, retain failed attempt, verify changed bytes/untouched guards and rerun affected check once; further unsupported failure stops affected work. Do not rewrite immutable evidence, weaken TLS, skip required tests, disable privacy checks or broaden production permissions. Genuine product/test failures require causal inspection and bounded ordinary correction within owned files; otherwise stop and seek affected READY.

Final handoff binds exact accepted commit/tree/parent and three remote refs; website artifact root,429-file manifest/hash/bytes; Function stage root, full file manifest/hash/bytes, Node/npm/platform and lock identities; exact host-root/archive instructions; actual local checks and remaining auth/challenge/deployment/mail/inbox gates. Infrastructure must create/review its own deployment candidate and archive receipt if needed. No credentials or secret values enter the handoff. Worker returns proposal SHA then waits for exact READY; subsequent independent gates are technical gates under existing user publication authorization.

Files:
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/AGENTS.md
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Documentation/Projects/Working/SDA-Standalone-HTML-Planning-2026-11-16.md
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Documentation/Projects/Plans/SDA-Contact-Titan-Adapter-Addendum.md
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Documentation/Projects/Plans/SDA-Contact-Linked-Endpoint-Addendum.md
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Documentation/Projects/SDA-Publishing.md
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/README.md
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/local.settings.example.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/package.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/package-lock.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/host.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/src/dependencies.js
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/src/index.js
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/src/titan-smtp.js
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/test/browser.cjs
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/test/browser-linked-endpoint.cjs
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/test/titan-smtp.test.js
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Static/SDA-Standalone/README.md
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Static/SDA-Standalone/assets/contact.js
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Static/SDA-Standalone/index.php/contact.html
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Static/SDA-Standalone/staticwebapp.config.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Static/SDA-Standalone/tools/serve.cjs
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Scripts/Publish-SdaWebsite.mjs
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Functions/SDA.Contact/.tools/node_modules/azure-functions-core-tools/bin/func.exe
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation-swa-routes-08/Scripts/Test-SdaWebsiteRoutes.mjs
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation-swa-routes-08/dist/swa-routes-08/result.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation-swa-routes-08/dist/swa-routes-08/official-cli/package-lock.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation-swa-routes-08/dist/swa-routes-08/official-cli/node_modules/@azure/static-web-apps-cli/dist/msha/routes-engine/route-processor.js
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation-swa-routes-08/dist/swa-routes-08/official-cli/node_modules/@azure/static-web-apps-cli/dist/msha/routes-engine/rules/routes.js
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Static/SDA-Standalone/output-manifest-contact-titan-01.json
file:///C:/GitHub/SiliconDreamArtists/PublishGraph.Foundation/Static/SDA-Standalone/output-manifest-contact-linked-endpoint.json
file:///C:/GitHub/SiliconDreamArtists/BDDB.AITooling/guidance/standard-practices.md
file:///C:/GitHub/SiliconDreamArtists/BDDB.AITooling/guidance/worker-review-cycle.md
