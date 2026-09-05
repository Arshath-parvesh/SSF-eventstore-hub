const Jimp = require('jimp');
const potrace = require('potrace');
const fs = require('fs');
const path = require('path');

function tracePromise(image, options) {
  return new Promise((resolve, reject) => {
    potrace.trace(image, options, (err, svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

function extractPaths(svg) {
  const matches = [...svg.matchAll(/<path[^>]*d="([^"]+)"/g)];
  return matches.map(m => m[1]);
}

async function vectorizeLogo() {
  console.log('[1/4] Loading logo_source.jpg...');
  const img = await Jimp.read('public/images/logo_source.jpg');
  const w = img.bitmap.width;
  const h = img.bitmap.height;

  // Create 3 mask images
  const greenMask = new Jimp(w, h, 0xFFFFFFFF);
  const blueMask = new Jimp(w, h, 0xFFFFFFFF);
  const textMask = new Jimp(w, h, 0xFFFFFFFF);

  img.scan(0, 0, w, h, function(x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];

    // Green leaf: Green dominant
    if (g > 115 && g > r * 1.3 && g > b * 1.1) {
      greenMask.setPixelColor(0x000000FF, x, y);
    }
    // Blue wings: Blue dominant, upper half
    else if (b > 115 && b > r * 1.1 && y < 350) {
      blueMask.setPixelColor(0x000000FF, x, y);
    }
    // Black text "SSF": Very dark pixels in lower area
    else if (r < 85 && g < 85 && b < 85 && y >= 320) {
      textMask.setPixelColor(0x000000FF, x, y);
    }
  });

  console.log('[2/4] Generating masks and tracing vector paths...');
  const greenBuf = await greenMask.getBufferAsync(Jimp.MIME_PNG);
  const blueBuf = await blueMask.getBufferAsync(Jimp.MIME_PNG);
  const textBuf = await textMask.getBufferAsync(Jimp.MIME_PNG);

  const opt = {
    optTolerance: 0.15,
    threshold: 128,
    turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY
  };

  const greenSvg = await tracePromise(greenBuf, opt);
  const blueSvg = await tracePromise(blueBuf, opt);
  const textSvg = await tracePromise(textBuf, opt);

  const greenPaths = extractPaths(greenSvg);
  const bluePaths = extractPaths(blueSvg);
  const textPaths = extractPaths(textSvg);

  console.log(`[3/4] Extracted paths: ${greenPaths.length} green, ${bluePaths.length} blue, ${textPaths.length} text.`);

  const finalSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">
  <defs>
    <linearGradient id="ssfBlueGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1D73BA" />
      <stop offset="60%" stop-color="#3B82F6" />
      <stop offset="100%" stop-color="#60A5FA" />
    </linearGradient>
  </defs>
  <g fill-rule="evenodd" transform="translate(0, 0)">
    <!-- Green Leaf Crescent -->
    ${greenPaths.map(d => `<path d="${d}" fill="#3AB648" />`).join('\n    ')}
    <!-- Stylized Blue Wings -->
    ${bluePaths.map(d => `<path d="${d}" fill="url(#ssfBlueGradient)" />`).join('\n    ')}
    <!-- SSF Typography -->
    ${textPaths.map(d => `<path d="${d}" fill="#000000" />`).join('\n    ')}
  </g>
</svg>`;

  fs.writeFileSync('public/images/ssf-logo.svg', finalSvg);
  console.log('[4/4] Saved public/images/ssf-logo.svg! Size:', finalSvg.length);
}

async function vectorizeFlag() {
  console.log('[Flag] Generating high-clarity ssf-flag.svg...');
  const b64 = fs.readFileSync('public/images/login_hero_source.jpg').toString('base64');
  const w = 474;
  const h = 474;

  const flagSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="100%" height="100%">
  <defs>
    <filter id="flagGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#3AB648" flood-opacity="0.35"/>
    </filter>
    <clipPath id="flagRoundedClip">
      <rect x="0" y="0" width="${w}" height="${h}" rx="24" ry="24"/>
    </clipPath>
  </defs>
  <g clip-path="url(#flagRoundedClip)" filter="url(#flagGlow)">
    <image width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/jpeg;base64,${b64}" />
    <rect x="0" y="0" width="${w}" height="${h}" rx="24" ry="24" fill="none" stroke="#3AB648" stroke-width="3" stroke-opacity="0.5"/>
  </g>
</svg>`;

  fs.writeFileSync('public/images/ssf-flag.svg', flagSvg);
  console.log('[Flag] Saved public/images/ssf-flag.svg! Size:', flagSvg.length);
}

async function main() {
  await vectorizeLogo();
  await vectorizeFlag();
}

main().catch(console.error);
