# Website producer-artifact protocol

The [machine contract](artifact-protocol.json) and [local checker](validate-artifact-protocol.cjs) define evidence for a future Actions producer compatible with the accepted immutable website consumer. **No producer workflow or actual run/artifact is defined, run or accepted here.** Current deployment bindings remain null. Local contract checks do not award independent acceptance, activate a binding or authorize cloud work.

The deployment artifact remains exactly `website.zip` and `package.json`. Do not add this protocol, source/build evidence or review receipts to that bundle. Existing package/consumer/workflow/runtime sources are unchanged. The new files are under the existing excluded tools directory and do not change publish inventory.

The existing package receipt supplies `sourceCommit`, literal `sourceDirty`, exact dotnet/node versions, startup, ZIP path/hash/size, three host-source hashes, content inventory and actual ZIP entry inventory. A historical dirty local package has no Actions producer provenance and is not promotable under this protocol. A future fresh build has a newly observed ZIP hash; it need not equal an old local ZIP.

A future reviewed producer must build its exact `run.head_sha` from this repository. Capture commit/tree, producer workflow path and its source hash/blob, reviewed source-input inventory (path, Git blob/mode, SHA256, size), accepted content contract, all452 runtime files and exact toolchain/actions/runner identity. Preserve raw empty pre/post `git status --porcelain=v1 -z --untracked-files=all` observations and their hashes, matching HEAD/tree, plus an empty pre-build ignored-input inventory. No `clean:true` or approval flag substitutes for those observations. Use a fresh isolated checkout/build directory; retain outputs under the already ignored artifacts directory so the unchanged builder can report `sourceDirty:false`.

The supplemental producer-evidence JSON stays outside the two-file bundle. It records exact source/toolchain facts, upload artifact ID/name/archive digest/retention request and run ID/attempt. Capture the final upload outputs before the producer ends. **After the run completes**, a read-only observer adds actual successful completed-run metadata, artifact/run/source linkage, API archive digest, creation/expiry timestamps, `expired:false` and observation time. An in-progress producer cannot prove its own final success. Future producer implementation must retain these exact bytes at a reviewed capture location; this phase invents no capture, workflow or run.

The GitHub artifact archive digest (`sha256:<hex>`) identifies the downloaded outer archive. It is separate from the inner `website.zip` SHA256 and the raw `package.json` SHA256. Keep package receipt bytes unchanged when hashing. Check the exact outer two-file inventory and the inner ZIP inventory against the reviewed receipt, sizes and hashes, including452 exact wwwroot members. Reject extra/duplicate/unsafe/link entries. An action digest warning alone is not verification. The optional CLI reader uses the established local PowerShell7/.NET ZipFile pattern, bounds names/counts/sizes before hashing and performs no extraction or rebuild.

Record requested retention and observed expiry separately. Reject missing/deleted artifacts, `expired:true`, missing/invalid expiry, expiry at or before the current validation time, invalid observation order or identity drift. There is no latest-artifact fallback or claim of permanent retention. CLI time is captured at invocation; only synthetic unit checks inject a clock.

An external independent source/build PASS receipt must bind exact protocol/producer-evidence/source-input/toolchain hashes, source commit/tree, run/attempt/artifact IDs, archive/ZIP/package hashes and reviewed ZIP inventory. Its exact bytes/hash, function/gate and independent reviewer/worker identities come from a separately fixed expected record. The validator checks that linkage and reports `local-contract-checks-pass` or `local-contract-checks-fail`; it neither creates independent PASS nor establishes that supplied observations are truthful. Actual source/run observations and independent review remain required future evidence.

The expected record and source/build receipt also bind `observationsSha256`: the checker-provided canonical hash of `{run, artifact, observedAtUtc}`. This covers the complete supplied status and expiry observations, so a later expiry/status edit cannot reuse the same reviewed observation identity.

The consumer's env/app-specific `artifact-acceptance` wrapper is separate. Only after actual owner outputs and exact review may an owner create that wrapper, preserving the consumer's kind/function/gate/PASS/environment/app/source/ZIP fields and linking the source/build acceptance hash. No real wrapper or Azure identity is fabricated by this protocol. Synthetic compatibility tests call the accepted consumer exports; the consumer does not automatically enforce every supplemental source/build field, so future owner review must retain the complete linkage.

Run the bounded synthetic checker from the repository root:

```powershell
node --check Static/SDA-WebApp/tools/validate-artifact-protocol.cjs
node --check Static/SDA-WebApp/tools/check-artifact-protocol.cjs
node Static/SDA-WebApp/tools/check-artifact-protocol.cjs --output artifacts/protocol/check-01.json
```

For future locally retained **actual** evidence, the read-only interface is:

```powershell
node Static/SDA-WebApp/tools/validate-artifact-protocol.cjs --packet <producer-evidence-envelope.json> --expected <independently-fixed-identities.json> --archive <downloaded-artifact.zip> --bundle <two-file-directory> --output <fresh-report.json>
```

The packet carries raw producer-evidence and source/build acceptance bytes as base64, actual run/artifact observations and optional separately reviewed consumer-wrapper bytes. Expected identities pin those bytes and every linkage; they must come from independent reviewed evidence, not from candidate self-approval. The interface fetches nothing, builds nothing and publishes nothing. Synthetic tests use deliberately tiny content/archive observations and explicitly fake IDs; they prove local rejection/compatibility behavior only. Current token/environment/provider/domain/SCM/capacity and producer implementation gates remain separate and blocked.
