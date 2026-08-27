import fs from "node:fs";


function assertIncludes(source, value, label) {
  if (!source.includes(value)) {
    throw new Error(label + ": missing " + JSON.stringify(value));
  }
}


const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

const googleAdsNavMatch = html.match(/<button[^>]*id="googleAdsNav"[\s\S]*?<\/button>/);
assertIncludes(html, 'data-nav-primary="google-ads"', "Google Ads primary navigation markup");
assertIncludes(html, 'data-i18n="nav.googleAdsHint"', "Google Ads primary navigation hint");
if (!googleAdsNavMatch || googleAdsNavMatch[0].includes('id="productsSubnav"')) {
  throw new Error("Google Ads should be rendered as a standalone primary navigation item");
}
const productsSubnavMatch = html.match(/<div class="nav-subnav[^\"]*" id="productsSubnav"[\s\S]*?<\/div>/);
if (!productsSubnavMatch || productsSubnavMatch[0].includes('id="googleAdsNav"')) {
  throw new Error("Google Ads should not be nested inside Products & offers");
}

[
  'id="googleAdsNav"',
  'id="googleAdsPage"',
  'id="googleAdsRangeButtons"',
  'id="googleAdsStartDate"',
  'id="googleAdsEndDate"',
  'id="googleAdsKpis"',
  'id="googleAdsChart"',
  'id="googleAdsMerchantRows"',
  'id="googleAdsUnmatchedList"',
  'id="googleAdsMethod"'
].forEach((value) => assertIncludes(html, value, "Google Ads workbench markup"));

[
  'switchPage("google-ads")',
  'if (page === "google-ads") return "google-ads";',
  'currentGroupName === "google-ads"',
  '/api/ui/db/google-ads-workbench?',
  'function _googleAdsRenderChart',
  'function _bindGoogleAdsChartDrag',
  'setPointerCapture',
  'chart.scrollLeft',
  'function _googleAdsRenderMerchantTable',
  'function _googleAdsLoad',
  'renderGoogleAdsPage();',
  '_bindGoogleAdsPageInteractions();'
].forEach((value) => assertIncludes(app, value, "Google Ads workbench behavior"));

[
  ".google-ads-page",
  ".google-ads-kpis",
  ".google-ads-chart",
  ".google-ads-chart-track",
  ".google-ads-chart.is-dragging",
  "touch-action: pan-y",
  "width: auto",
  ".google-ads-table-wrap",
  "@media (max-width: 560px)"
].forEach((value) => assertIncludes(styles, value, "Google Ads workbench styles"));

assertIncludes(styles, ".nav-primary-link", "Google Ads primary navigation styles");
assertIncludes(styles, "font-size: 14px", "Expanded sidebar navigation typography");
assertIncludes(styles, "font-size: 13.5px", "Expanded sidebar submenu typography");

const combined = html + app + styles;
[
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, "OAuth client secret"],
  [/1\/\/0[A-Za-z0-9_-]{20,}/, "OAuth refresh token"],
  [/\d{12}-[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com/, "OAuth client ID"]
].forEach(([pattern, label]) => {
  if (pattern.test(combined)) {
    throw new Error("browser assets must not contain a Google Ads " + label);
  }
});

console.log("Google Ads workbench frontend checks passed");
