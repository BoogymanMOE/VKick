import sharp from "sharp";

const input = "D:/football/vkick logos/android-chrome-512.png";
const output = "D:/football/telegram-miniapp-640x360.png";

const resizedLogo = await sharp(input)
  .resize(360, 360, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 1 }
  })
  .toBuffer();

await sharp({
  create: {
    width: 640,
    height: 360,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 1 }
  }
})
  .composite([{ input: resizedLogo, gravity: "center" }])
  .png()
  .toFile(output);

console.log("✅ Created:", output);
console.log("   Size: 640x360 (Telegram Mini App cover)");
