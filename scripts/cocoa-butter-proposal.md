# Applied v2 recipe change

Applied to the actual business-os Eve Did It v2 and Violet’s Demise v2 recipes
on 2026-11-21 at revision 49. Each now uses 1 US tablespoon melted cocoa butter
per batch; the avocado oil inputs are retained with `removed: true`. The amount
is a provisional starting point and needs a recipe trial. Supplier selection
and a measured gram conversion remain unknown. Current-version flags and V1
recipes were preserved.

The revision-checked maintenance script is
`../business-os/scripts/replace_v2_cocoa_butter.py`. Its dry run passed, apply
created a verified backup under `../business-os/.local/db-fixes/`, and both
recipes were read back through MCP. The website updater explicitly reads both
V2 recipes and uses an estimated 14 g per tablespoon solely for weight ordering.

## Product evidence

The user supplied [front](https://m.media-amazon.com/images/W/BW_MEDIAX_AVIF_MEASUREMENT_1306696-T4/images/I/71ARaRdk0EL._SL1500_.jpg)
and [back](https://m.media-amazon.com/images/W/BW_MEDIAX_AVIF_MEASUREMENT_1306696-T4/images/I/8138gEnBn+L._SL1500_.jpg)
label images for Zatural deodorized cocoa butter wafers. The ingredient statement
identifies 100% pure prime pressed, deodorized cocoa butter. The label states
approximately 6 wafers per 14 g serving; per serving it lists 130 calories,
14 g total fat, and 8 g saturated fat. The package says 1 lb (454 g).

Six wafers (approximately 14 g) are an alternative provisional starting measure
close to the estimated mass of the avocado oil. The label does not establish
that six wafers melt to one tablespoon; verify the amount during the trial.
These label details do not establish a measured volume-to-weight conversion.
