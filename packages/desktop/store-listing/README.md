# Microsoft Store listing pack

This folder contains the Store-ready marketing copy and visual assets for the Paddie Studio Microsoft Store listing.

The screenshots in `assets/` are derived from app/product screenshots already checked into the RMN landing-page codebase:

- `C:\Users\Michael\Documents\GitHub\RMN\landing-page\public\paddie-generated\brand-studio-edit-frame.png`
- `C:\Users\Michael\Documents\GitHub\RMN\landing-page\public\paddie-generated\brand-template-attach-frame.png`
- `C:\Users\Michael\Documents\GitHub\RMN\landing-page\public\paddie-generated\brand-workflow-builder-frame.png`
- `C:\Users\Michael\Documents\GitHub\RMN\landing-page\public\paddie-generated\workflow-builder-composite.png`
- `C:\Users\Michael\Documents\GitHub\RMN\landing-page\public\paddie-generated\product-surfaces-composite.png`
- `C:\Users\Michael\Documents\GitHub\RMN\landing-page\public\paddie-generated\brand-unified-canvas-frame.png`

The video asset comes from:

- `C:\Users\Michael\Documents\GitHub\RMN\landing-page\public\main-paddie-ad-2026.mp4`

## Assets

Upload these as Desktop screenshots in this order:

1. `assets/01-studio-pick-element.png`
2. `assets/02-templates-curated-parts.png`
3. `assets/03-workflow-builder-canvas.png`
4. `assets/04-studio-workflow-builder-composite.png`
5. `assets/05-studio-portal-surfaces.png`
6. `assets/06-unified-studio-canvas.png`

Use `assets/paddie-platform-overview.mp4` as the optional trailer video.

The numbered PNG files are normalized to 1920x1080. The RMN source file paths above are kept here for traceability without duplicating the raw originals in this repository.

## Copy

Use `listing.en-US.md` for Partner Center copy-paste fields. `listing.en-US.json` mirrors the same content in a machine-readable shape for future automation.

## Current automation boundary

The existing GitHub workflow publishes the MSIX package. Store listing text, screenshots, and trailer upload still need to be applied in Partner Center unless a separate listing-metadata automation is added.
