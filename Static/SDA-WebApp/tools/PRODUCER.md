# SDA website build-only producer

[The build workflow](../../../.github/workflows/build-sda-website.yml) is separate from the sole manual deployment workflow. It automatically builds only pushes to `main` or `agents/sda-website-migration-setup` affecting its fixed source paths. It has `contents: read`, no environment or identity token, no deployment commands and no manual dispatch. Publication of this new trigger requires its own exact reviewed effect packet before a push; source review alone does not authorize an Actions run.

The workflow checks out the exact push SHA with stored credentials disabled. Pinned actions install Node22.9.0 and .NET SDK10.0.404, with the SDK in a runner-temporary isolated directory. The helper verifies actual versions and the resolved SDK executable path before building. PowerShell, Git and hosted image versions are observed in evidence; `ubuntu-24.04` is not an immutable image identity. No cache is restored.

## Build facts

[producer.cjs](producer.cjs) has fixed `prepare`, `verify-build`, `record-upload` and read-only `observe` modes. Before creating output, `prepare` requires actual empty raw Git status, exact HEAD/tree/context and no ignored prebuild files. It hashes tracked source bytes against Git blobs, pins the accepted builder/host/protocol and includes all452 content files. It refuses dirty or cached input rather than accepting caller-provided clean booleans.

The unchanged [package builder](package.cjs) creates a portable Linux ZIP with `dotnet /home/site/wwwroot/SDA.Website.dll` startup. `verify-build` checks its receipt, exact accepted452 bytes, actual ZIP inventory/hashes, portable file names and postbuild raw clean state. Generated `bin`, `obj` and `artifacts` outputs may exist after the build. They cannot change the recorded HEAD/tree or tracked source.

The candidate bundle contains exactly `website.zip` and `package.json`. It is named `sda-website-{SHA}-{runId}-{attempt}`, retained for seven configured days, and capped at200MiB total payload. `record-upload` uses the native upload ID and outer artifact archive digest to create supplementary `producer-evidence.json`. That evidence is uploaded as a distinct `{bundleName}-evidence` artifact, capped at2MiB. The outer GitHub archive digest, inner website ZIP digest and package receipt digest are different identities. The evidence artifact's digest is observed later, avoiding selfreference. Failure after the bundle upload can leave a partial candidate; that candidate is not accepted.

Producer evidence never declares completed success or independent acceptance. Only a later observer can capture a completed successful run. Seven-day retention is a configuration, not a durability promise: actual expiry and nonexpired availability must be observed before consumption.

## Read-only observation

After the separately reviewed push effect, an external fixed packet supplies the exact repository, commit/tree, producer workflow path/hash and branch. `observe` requires the same checked-out source, uniquely selects the matching push run, refuses reruns or incomplete/failed runs, and checks the exact two deterministic artifacts, run/source linkage, sizes, digests and expiry. It downloads only those artifact IDs, checks outer hashes, and extracts only fixed leaf names with bounded expanded sizes and link rejection. It checks the payload ZIP and producer source/tool/upload evidence against the exact checkout. It never chooses a latest artifact, dispatches, reruns, cancels, deletes, uploads, rebuilds or generates an independent receipt.

The observer is a single bounded read attempt. The separately reviewed effect packet controls any external polling: at most45minutes from push,15second intervals, one first run/attempt1, job timeout25minutes, at most two named archive downloads within the stated caps. Ambiguous, inaccessible, expired, failed or timed-out observations stop acceptance; there is no PAT or broader-permission fallback. No automatic retry can create another run.

An invocation, after that effect is independently READY, has this shape; the fixed packet must already be independently reviewed and exist below the owned ignored prefix:

```text
node Static/SDA-WebApp/tools/producer.cjs --mode observe --fixed artifacts/SDA-WEBAPP-PRODUCER-01/effect-fixed.json --directory artifacts/SDA-WEBAPP-PRODUCER-01/observed-01 --output artifacts/SDA-WEBAPP-PRODUCER-01/observation-01.json
```

Candidate observations remain inputs to independent source/build review under the unchanged [artifact protocol](ARTIFACT-PROTOCOL.md). Its previous documentary-phase no-producer scope remains historical; the later explicit producer authorization creates this bounded phase. No source/build PASS or environment/app-specific consumer acceptance is manufactured. The deployment bindings remain null. Provider outputs, environment agreement, token permissions, OAuth, domain/TLS and capacity gates remain unresolved.

## Local verification

```text
node --check Static/SDA-WebApp/tools/producer.cjs
node --check Static/SDA-WebApp/tools/check-producer.cjs
node Static/SDA-WebApp/tools/check-producer.cjs --output artifacts/SDA-WEBAPP-PRODUCER-01/check-01.json
```

The checker uses explicitly synthetic contexts, upload/run/artifact metadata and a tiny actual local Git repository and real ZIP files. It proves local guard behavior and ZIP-reader mechanics, not Actions permissions or service facts. Outputs must be fresh. Its synthetic Git commits are confined to ignored fixtures; they are not producer source identities.

One separate local build of the unchanged package builder checks actual build/portable inventory. During source implementation the worktree is dirty, so its actual `sourceDirty: true` receipt is retained and is **not promotable**. It is not substituted into production evidence. A future actual Actions build must independently observe clean state and will have a newly measured ZIP hash. No historical ZIP hash or reproducible build identity is assumed.
