# Changelog

## 0.1.0 (2026-10-28)


### Features

* an urgent issue's Stages start any time, over the Ceiling ([#43](https://github.com/dkomeza/banki/issues/43)) ([f743030](https://github.com/dkomeza/banki/commit/f74303031a1ce3cf2fbb00e7a211b9928e568c68))
* banki setup and banki seed CLI commands (BAN-85) ([#20](https://github.com/dkomeza/banki/issues/20)) ([8923bfa](https://github.com/dkomeza/banki/commit/8923bfa03fcaa18744f2302ccb0d341d8c65e689))
* bootstrap Edge and Production on the home server (BAN-98) ([#52](https://github.com/dkomeza/banki/issues/52)) ([164554a](https://github.com/dkomeza/banki/commit/164554a79e9b57d8cc67d2a8f9a771d13b0696dc))
* card list with search and tags (BAN-14) ([#58](https://github.com/dkomeza/banki/issues/58)) ([a723b30](https://github.com/dkomeza/banki/commit/a723b308c1fc255010e69add9fc8de6eb55652a3))
* create, edit and delete Cards (BAN-12) ([#48](https://github.com/dkomeza/banki/issues/48)) ([3a509d7](https://github.com/dkomeza/banki/commit/3a509d721983ab33d317610b725195cb7c661d69))
* create, edit and delete decks, with Home as the deck list (BAN-11) ([#42](https://github.com/dkomeza/banki/issues/42)) ([f5b054c](https://github.com/dkomeza/banki/commit/f5b054c884b569312d6f36fc5da6b824f3d06506))
* cut Releases with release-please and promote Edge's images to Production (BAN-101) ([#61](https://github.com/dkomeza/banki/issues/61)) ([c76995e](https://github.com/dkomeza/banki/commit/c76995e5c01cbf870f275139c5345bd0007f7ff3))
* Docker deployment behind one origin, with a smoke script (BAN-76) ([#17](https://github.com/dkomeza/banki/issues/17)) ([156f965](https://github.com/dkomeza/banki/commit/156f9651bf6d80ea273b125a8d5d9a02c8cc0895))
* duplicate card warning (BAN-16) ([#50](https://github.com/dkomeza/banki/issues/50)) ([d492ee3](https://github.com/dkomeza/banki/commit/d492ee3e1c5a17d2e50b150a1fde5c32cc899eab))
* email and password sign-in with Setup and a CLI reset (BAN-7) ([#18](https://github.com/dkomeza/banki/issues/18)) ([fb3555c](https://github.com/dkomeza/banki/commit/fb3555c299d6cfeb75ed5f80d3157e258490c48c))
* folders for organizing decks (BAN-10) ([#45](https://github.com/dkomeza/banki/issues/45)) ([ccc86eb](https://github.com/dkomeza/banki/commit/ccc86eb7fa8255a8d694ffbce030d720f391c48f))
* image upload for cards (BAN-17) ([#57](https://github.com/dkomeza/banki/issues/57)) ([a20f1de](https://github.com/dkomeza/banki/commit/a20f1dec88df694c25b7b1292e8e86bf615a5dce))
* installable PWA shell with Paper & ink theme (BAN-8) ([#28](https://github.com/dkomeza/banki/issues/28)) ([5f1c62b](https://github.com/dkomeza/banki/commit/5f1c62becef144168fddaf92e1a4e30c33b56563))
* multi-arch main images and Edge Deployments (BAN-97) ([#54](https://github.com/dkomeza/banki/issues/54)) ([994cf76](https://github.com/dkomeza/banki/commit/994cf76619b25f597668de860664dfb01095ce4e))
* OpenRouter API key and curated Model list in Settings (BAN-36) ([#39](https://github.com/dkomeza/banki/issues/39)) ([37016fd](https://github.com/dkomeza/banki/commit/37016fdcc8f9e55f34f17cc6481f05425a07a75f))
* Preview limits and a pull agent that updates itself (BAN-90) ([#25](https://github.com/dkomeza/banki/issues/25)) ([20e5085](https://github.com/dkomeza/banki/commit/20e508537bfe5be7d878c9e760f122b14a84a734))
* Preview pull agent that deploys and tears down Previews (BAN-89) ([#24](https://github.com/dkomeza/banki/issues/24)) ([dcfd9bc](https://github.com/dkomeza/banki/commit/dcfd9bcb828d36842ef68638946cd4552ed554cf))
* Recently deleted, Restore and Removal by Deletion, and Undo for Deck and Folder deletes (BAN-13) ([#53](https://github.com/dkomeza/banki/issues/53)) ([4c63d27](https://github.com/dkomeza/banki/commit/4c63d2721e54a12b2877cd0b73fe6fa1e8075344))
* render Cards' Markdown and Formulas with KaTeX (BAN-18) ([#60](https://github.com/dkomeza/banki/issues/60)) ([a626537](https://github.com/dkomeza/banki/commit/a62653751e298f1561dbbfa76872453a481441be))
* Settings page with Timezone, Day start and Account (BAN-9) ([#30](https://github.com/dkomeza/banki/issues/30)) ([ed4ade5](https://github.com/dkomeza/banki/commit/ed4ade5e38c26163a27350113594bd3ada206058))
* Slug Previews, a Preview from any branch in a pool of its own (BAN-91) ([#31](https://github.com/dkomeza/banki/issues/31)) ([9eb357d](https://github.com/dkomeza/banki/commit/9eb357d9e9656f53e54ea299cccb5fd739c1ff8c))
* SQLite data directory and migrations on startup (BAN-75) ([#16](https://github.com/dkomeza/banki/issues/16)) ([c4469de](https://github.com/dkomeza/banki/commit/c4469de9e1424a94e4f197b43ee65cf20520cf37))
* the Dashboard, a read-only page of what the Runner is doing (BAN-96) ([#41](https://github.com/dkomeza/banki/issues/41)) ([81061a0](https://github.com/dkomeza/banki/commit/81061a00c8c4a4f12f6cd05a9654219c477cedcc))
* the Dispatcher picks the next Stage, gates it on usage, and waits without tokens (BAN-95) ([#35](https://github.com/dkomeza/banki/issues/35)) ([2850432](https://github.com/dkomeza/banki/commit/2850432eb60d834a0e6805ef103954cfce9efdac))
* the pull agent deploys Edge and Production (BAN-100) ([#59](https://github.com/dkomeza/banki/issues/59)) ([a0457d6](https://github.com/dkomeza/banki/commit/a0457d651f469d894718b90ecd6b897b8b0b09ac))
* the Runner's containers, Broker and credentials (BAN-94) ([#34](https://github.com/dkomeza/banki/issues/34)) ([3cb7f07](https://github.com/dkomeza/banki/commit/3cb7f07be8193b1d5cddfd2b7ea34ae42c318bdc))
* the sign-in cookie uses the __Host- prefix (BAN-99) ([#51](https://github.com/dkomeza/banki/issues/51)) ([f0ccc66](https://github.com/dkomeza/banki/commit/f0ccc6671a2226a748d5b8b037d66c4e3b8f3584))
* the sign-in cookie uses the __Host- prefix on https (BAN-99) ([f0ccc66](https://github.com/dkomeza/banki/commit/f0ccc6671a2226a748d5b8b037d66c4e3b8f3584))
* ui compare with before/after shots in PR bodies (BAN-88) ([#23](https://github.com/dkomeza/banki/issues/23)) ([2c4cc47](https://github.com/dkomeza/banki/commit/2c4cc47cd6ca7dcc69f6ebd9120bffee60f60dae))
* ui script and the ui-reviewer agent (BAN-87) ([#22](https://github.com/dkomeza/banki/issues/22)) ([2ec09b2](https://github.com/dkomeza/banki/commit/2ec09b275579090c3520f934d9abd6b6d203e2b7))
* walking skeleton with a typed health check (BAN-74) ([#15](https://github.com/dkomeza/banki/issues/15)) ([8cf2ace](https://github.com/dkomeza/banki/commit/8cf2ace261b8df6315d175f3d81de7464b0402b0))


### Fixes

* cut the first Release as v0.1.0 ([#62](https://github.com/dkomeza/banki/issues/62)) ([ccb9f55](https://github.com/dkomeza/banki/commit/ccb9f55f8ac4a3a279a31720d444248a4d17e9dc))
* the Dashboard's log page reads only its tail, and a failed stream stops instead of reloading ([#49](https://github.com/dkomeza/banki/issues/49)) ([a052e44](https://github.com/dkomeza/banki/commit/a052e444e9898a5d0f59a29edbf12a662a10b9b6))
* the Dashboard's log page reads only its tail, and a failed stream stops instead of reloading (BAN-96) ([a052e44](https://github.com/dkomeza/banki/commit/a052e444e9898a5d0f59a29edbf12a662a10b9b6))
* the Runner takes an issue's branch under any prefix, whoever started it (BAN-95) ([#36](https://github.com/dkomeza/banki/issues/36)) ([4c468f3](https://github.com/dkomeza/banki/commit/4c468f310ee9a5792087735085924394b0d2b8c9))
* the Runner waits out a fresh Linear token's blindness, and a Stage that never started costs nothing (BAN-95) ([#37](https://github.com/dkomeza/banki/issues/37)) ([990e9a8](https://github.com/dkomeza/banki/commit/990e9a8e3f6efea99ccef3fdc757492099283752))
