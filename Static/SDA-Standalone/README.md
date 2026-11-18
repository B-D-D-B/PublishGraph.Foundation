# SDA captured static website

Serve this directory at the HTTP site root using Azure Static Web Apps or the local rewrite-aware server below. Pretty paths require the supplied explicit rewrite rules. Root-relative links/resources mean direct `file://` browsing and mounting this site below a URL subpath are no longer supported. A generic static server without rewrite support serves physical HTML URLs only. No build, CMS, PHP, .NET or database is needed for the local pages. Restored original third-party iframes require an internet connection and available remote services. Historical `index.php` is a directory containing HTML files.

The exact runtime set is the 42 `pages[].output` files and 384 `assets[].output` files in `coverage-manifest.json`, plus `staticwebapp.config.json`, `assets/static-preview.js` and `assets/contact.js` (429 files). The seven crop outputs are already included in the asset manifest. `pretty-routes.json` is a development routing catalog and is excluded from the public artifact. Preserve these relative paths when copying. Everything else is development tooling, provenance or review evidence and may be omitted from a runtime copy. Reused third-party copyright/license notices remain inside their original CSS and JavaScript.

The capture deliberately overflows narrow screens, including mobile and portrait tablet. Navigation links, dropdowns, mobile menu, browser history and back-to-top use the captured theme behavior. The Pulses tab and submenu are hidden; their direct local page URLs remain available. External social links are explicit outbound links. At desktop/tablet widths, the original theme opens only the first dropdown level: deeper Art project/gallery and About Charter lists remain hidden on hover. The replica preserves that inherited limitation; the deeper pages remain local HTML destinations and the mobile expanded menu exposes their links. The exploratory deeper-hover failures and source/current conformance measurements are retained in the evidence. At390px mobile and768px portrait widths, the inherited overflow also blocks native pointer activation of Back to Top in the test browser; keyboard activation works and matches the source. Desktop and1024px pointer activation work.

The source contains five placeholders (page IDs 10,12,13,20,21) and eight missing Pulses article bodies (34–41); their captured shells/error state remain. No articles or feeds have been invented. Original iframe elements and routes are restored from the captured source, including their original dimensions, classes, hidden state and slideshow/autoplay parameters. The frame.sda.studio feeds and gallery.sda.studio slideshows load online; remote availability and browser restrictions are outside the local site. Historical cropped unavailable-feed assets remain as provenance and are no longer displayed. Surrounding content and layout are HTML/CSS.

Contact fields remain editable and native validation is retained. Submit shows “Static preview: message not sent”; it never sends or persists data. Activating the captured CAPTCHA reports that refresh is unavailable. Without JavaScript, Submit stays inert so entered values are neither transmitted nor put in a URL. Membership and other page content describes the captured service; no enrollment, payment or CMS backend is provided.

Historical pixel-verification evidence predates the intentional navigation and live-frame changes. The full historical pixel verifier below is retained for provenance; current navigation/frame checks are in `evidence/nav-followup/`. Live artwork cannot be compared to unavailable-feed capture pixels.

Developer verification (Node is needed only for these commands):

```powershell
npm ci
node tools/check.cjs
node tools/serve.cjs --port 4173
node tools/verify.cjs --browser-channel msedge --run baseline
```

Stop the manual server with Ctrl+C. Automated verification creates and closes its own loopback servers, including `/preview/`, rejects existing evidence run names and returns nonzero for required failures. Use a fresh run name when retaining another attempt. Dependencies are pinned in `package-lock.json`. Original input paths in `input-manifest.json` are required to rerun source comparisons; consumers do not need that source tree to browse the site. The baseline evidence records actual environment and failures; current Edge differs from the historical reference browser and reference images are never rebased. Pair139 uses the independently reviewed deterministic source-animation clock recipe in [capture proposal v2](evidence/animation-capture-proposal-v2.md); its source and replica captures matched the unchanged reference100%. The normal verifier delegates that one pair to the same recipe in its own fresh evidence directory and keeps its servers alive asynchronously.

`coverage-manifest.json` defines mappings and reference coverage; `input-manifest.json` records original file hashes; `url-rewrites.json` records resolved URLs; `dispositions.json` records removed Markdown fetches and deterministic replacements for original missing decorative CSS resources. `inline-inventory.json` and `iframe-inventory.json` retain the inspected original executable and embed inventory. `preimages/` retains implementation corrections. `evidence/` contains immutable actual/diff images and machine reports, including failed attempts.

## Pretty URLs

Canonical paths use the actual tab labels and full parent/subtab hierarchy. Home is `/`; `/sdaframe` and `/sdaframe/` are address-preserving aliases for `/sda-frame`. Canonical and trailing-slash URLs are served through 43 explicit default-index rewrite rules, including the SDA Frame alias. Virtual `/index.html` spellings also serve those pages; no redirects are added. All 42 original physical HTML URLs still return their pages directly. Unknown URLs return 404; there is no SPA fallback or redirect rule. Query strings and same-document fragments remain in the address bar. [pretty-routes.json](pretty-routes.json) is the complete machine-readable map.

| Canonical path | Existing file |
| --- | --- |
| `/` | `index.html` |
| `/about-sda` | `index.php/about.html` |
| `/about-sda/history` | `index.php/about/sda-history.html` |
| `/about-sda/timeline` | `index.php/about/sda-timeline.html` |
| `/about-sda/sda-art-singularity-charter` | `index.php/about/singularity-charter.html` |
| `/about-sda/sda-art-singularity-charter/press-release-sda-art-singularity-charter` | `index.php/about/singularity-charter/press-release.html` |
| `/art` | `index.php/art.html` |
| `/art/themes` | `index.php/art/frames.html` |
| `/art/galleries` | `index.php/art/galleries.html` |
| `/art/galleries/advanced-aether-adworks` | `index.php/art/galleries/advanced-aether-adworks.html` |
| `/art/projects` | `index.php/art/projects.html` |
| `/art/projects/advanced-aether-adworks` | `index.php/art/projects/advanced-aether-adworks.html` |
| `/art/sda-collection` | `index.php/art/sda-collection.html` |
| `/for-artists` | `index.php/artists.html` |
| `/for-artists/exposure` | `index.php/artists/exposure.html` |
| `/for-artists/commissions-royalties` | `index.php/artists/income.html` |
| `/for-businesses` | `index.php/businesses.html` |
| `/for-collectors` | `index.php/collectors.html` |
| `/for-collectors/commissions` | `index.php/collectors/commissions.html` |
| `/for-collectors/investor-bundles` | `index.php/collectors/investor-bundles.html` |
| `/for-collectors/nft-marketplaces` | `index.php/collectors/nft-marketplaces.html` |
| `/for-collectors/authenticated-digital-collectables` | `index.php/collectors/specifications.html` |
| `/about-sda/contact` | `index.php/contact.html` |
| `/sda-frame` | `index.php/feeds-sdaframe.html` |
| `/membership` | `index.php/membership.html` |
| `/membership/agents` | `index.php/membership/agents.html` |
| `/membership/amplifiers` | `index.php/membership/amplifiers.html` |
| `/membership/artists` | `index.php/membership/artists.html` |
| `/membership/curators` | `index.php/membership/curators.html` |
| `/membership/moderators` | `index.php/membership/moderators.html` |
| `/membership/operators` | `index.php/membership/operators.html` |
| `/membership/welcome` | `index.php/membership/welcome.html` |
| `/for-collectors/nft-2-0-proposal` | `index.php/nft-proposal.html` |
| `/pulses` | `index.php/pulses.html` |
| `/pulses/bddb` | `index.php/pulses/bddb.html` |
| `/pulses/point-break` | `index.php/pulses/point-break.html` |
| `/pulses/sda-frame` | `index.php/pulses/sda-frame.html` |
| `/pulses/sda-fusion` | `index.php/pulses/sda-fusion.html` |
| `/pulses/sda-skydeck` | `index.php/pulses/sda-skydeck.html` |
| `/pulses/sda-studio` | `index.php/pulses/sda-studio.html` |
| `/pulses/sovereign-trust` | `index.php/pulses/sovereign-trust.html` |
| `/about-sda/technology` | `index.php/sda-technology.html` |

Current local route checks: `node tools/check.cjs` and `node tools/pretty-routes-verify.cjs` (the latter retains a fresh immutable evidence run and refuses existing run names). `node tools/serve.cjs --port 4173` serves the explicit rewrite subset at http://127.0.0.1:4173/. The helper keeps existing case/traversal/MIME and mount behavior for other consumers; this site itself requires root hosting. Local tests do not establish full Azure runtime equivalence. Historical pixel/navigation reports remain provenance for their named snapshots.

For standard custom domains, attach `silicondreamartists.com` and `sda.studio` to the same Static Web App, then set `sda.studio` as the default domain. Azure automatically redirects the other domain to that default; see [Microsoft default-domain documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain-default). No Front Door or global redirect rule is required for this supported setup. Domain attachment, DNS, Azure deployment and the live redirect have not been performed or tested here.

## Contact form

The contact page uses its own handler and is disabled until an approved endpoint and Turnstile site key are configured in its public data attributes. It publishes no email address or email fallback; unconfigured submission shows a generic status. All other forms keep static-preview behavior. Backend setup, local tests, deployment prerequisites and rollback: [SDA.Contact](../../Functions/SDA.Contact/README.md). No mail provider or cloud deployment is configured by this local implementation.
