// server.js
import vision from "@google-cloud/vision";
import cors from "cors";
import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import sharp from "sharp";

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });

// --- Google Vision client ---
// If you didn't set GOOGLE_APPLICATION_CREDENTIALS env var, uncomment below line:
// const client = new vision.ImageAnnotatorClient({ keyFilename: "./google-vision-key.json" });
const client = new vision.ImageAnnotatorClient();

// ---------- MRZ helpers ----------
const formatDate = (yyMMdd) => {
  if (!/^\d{6}$/.test(yyMMdd)) return yyMMdd;
  const y = parseInt(yyMMdd.slice(0, 2), 10);
  const m = yyMMdd.slice(2, 4);
  const d = yyMMdd.slice(4, 6);
  const fullYear = y < 50 ? 2000 + y : 1900 + y;
  return `${fullYear}-${m}-${d}`;
};

const charValue = (ch) => {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55; // A->10
  if (ch === "<") return 0;
  return 0;
};

const checkDigit = (data) => {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += charValue(data[i]) * weights[i % 3];
  }
  return String(sum % 10);
};

const cleanLine = (s) =>
  s
    .toUpperCase()
    .replace(/ /g, "<")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/[^A-Z0-9<]/g, "");

const getMRZLines = (text) =>
  text
    .split("\n")
    .map((l) => cleanLine(l.trim()))
    .filter((l) => /^[A-Z0-9<]{25,}$/.test(l)); // >=25 keeps MRZ-like strings

// ---------- TD3 (Passports: 2 lines, 44 chars) ----------
const parseTD3 = (lines) => {
  if (lines.length < 2) return null;
  const line1 = (lines[0] + "<".repeat(44)).slice(0, 44);
  const line2 = (lines[1] + "<".repeat(44)).slice(0, 44);

  const documentType = line1.substring(0, 2);
  const issuingCountry = line1.substring(2, 5);
  const namesField = line1.substring(5);
  const lastName = namesField.split("<<")[0].replace(/</g, " ").trim();
  const firstName = (namesField.split("<<")[1] || "").replace(/</g, " ").trim();

  const passportNumber = line2.substring(0, 9).replace(/</g, "");
  const passportNumberCheckDigit = line2.substring(9, 10);
  const nationality = line2.substring(10, 13);
  const birthDateRaw = line2.substring(13, 19);
  const birthDateCheckDigit = line2.substring(19, 20);
  const sex = line2.substring(20, 21);
  const expiryDateRaw = line2.substring(21, 27);
  const expiryDateCheckDigit = line2.substring(27, 28);
  const optionalData = line2.substring(28, 42);
  const finalCheckDigit = line2.substring(43, 44);

  const pnOK = checkDigit(line2.substring(0, 9)) === passportNumberCheckDigit;
  const bdOK = checkDigit(birthDateRaw) === birthDateCheckDigit;
  const edOK = checkDigit(expiryDateRaw) === expiryDateCheckDigit;

  const compositeString =
    line2.substring(0, 10) +
    line2.substring(13, 20) +
    line2.substring(21, 28) +
    line2.substring(28, 42);
  const finalOK = checkDigit(compositeString) === finalCheckDigit;

  return {
    format: "TD3",
    documentType,
    issuingCountry,
    lastName,
    firstName,
    passportNumber,
    passportNumberCheckDigit,
    passportNumberValid: pnOK,
    nationality,
    birthDate: formatDate(birthDateRaw),
    birthDateCheckDigit,
    birthDateValid: bdOK,
    sex,
    expiryDate: formatDate(expiryDateRaw),
    expiryDateCheckDigit,
    expiryDateValid: edOK,
    optionalData: optionalData.replace(/</g, " ").trim(),
    finalCheckDigit,
    compositeValid: finalOK,
  };
};

// ---------- TD1 (ID cards: 3 lines, 30 chars each) ----------
const parseTD1 = (lines) => {
  if (lines.length < 3) return null;
  const l1 = (lines[0] + "<".repeat(30)).slice(0, 30);
  const l2 = (lines[1] + "<".repeat(30)).slice(0, 30);
  const l3 = (lines[2] + "<".repeat(30)).slice(0, 30);

  const documentType = l1.substring(0, 2);
  const issuingCountry = l1.substring(2, 5);
  const documentNumber = l1.substring(5, 14).replace(/</g, "");
  const documentNumberCheckDigit = l1.substring(14, 15);
  const optional1 = l1.substring(15, 30);

  const birthDateRaw = l2.substring(0, 6);
  const birthDateCheckDigit = l2.substring(6, 7);
  const sex = l2.substring(7, 8);
  const expiryDateRaw = l2.substring(8, 14);
  const expiryDateCheckDigit = l2.substring(14, 15);
  const nationality = l2.substring(15, 18);
  const optional2 = l2.substring(18, 29);
  const finalCheckDigit = l2.substring(29, 30);

  const namesField = l3;
  const lastName = namesField.split("<<")[0].replace(/</g, " ").trim();
  const firstName = (namesField.split("<<")[1] || "").replace(/</g, " ").trim();

  const docOK = checkDigit(l1.substring(5, 14)) === documentNumberCheckDigit;
  const bdOK = checkDigit(birthDateRaw) === birthDateCheckDigit;
  const edOK = checkDigit(expiryDateRaw) === expiryDateCheckDigit;

  const compositeString =
    l1.substring(5, 15) + // doc num + cd
    l2.substring(0, 7) + // birth + cd
    l2.substring(8, 15) + // expiry + cd
    l2.substring(18, 29) + // optional2
    l1.substring(15, 30); // optional1
  const finalOK = checkDigit(compositeString) === finalCheckDigit;

  return {
    format: "TD1",
    documentType,
    issuingCountry,
    documentNumber,
    documentNumberCheckDigit,
    documentNumberValid: docOK,
    nationality,
    birthDate: formatDate(birthDateRaw),
    birthDateCheckDigit,
    birthDateValid: bdOK,
    sex,
    expiryDate: formatDate(expiryDateRaw),
    expiryDateCheckDigit,
    expiryDateValid: edOK,
    optional1: optional1.replace(/</g, " ").trim(),
    optional2: optional2.replace(/</g, " ").trim(),
    lastName,
    firstName,
    finalCheckDigit,
    compositeValid: finalOK,
  };
};

// ---------- Preprocess (rotate/grayscale/threshold) ----------
async function preprocess(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outPath = path.join(dir, `${base}-proc.png`);

  await sharp(inputPath)
    .rotate() // fix EXIF rotation
    .grayscale()
    .normalize()
    .linear(1.15, -10)
    .threshold(140)
    .toFile(outPath);

  return outPath;
}

// ---------- OCR with Vision ----------
async function detectText(imagePath) {
  const [result] = await client.textDetection(imagePath);
  const detections = result.textAnnotations || [];
  return detections.length ? detections[0].description : "";
}

// ---------- Route ----------
app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  const tempPaths = [req.file.path];
  try {
    // Preprocess for more contrast (optional but helps)
    const preprocessed = await preprocess(req.file.path);
    tempPaths.push(preprocessed);

    // OCR
    const fullText = await detectText(preprocessed);

    // Extract MRZ-like lines
    let lines = getMRZLines(fullText).sort((a, b) => b.length - a.length);

    // If more than 3 lines came back, keep the top 3 by length
    if (lines.length > 3) lines = lines.slice(0, 3);

    // Try TD3 first (2 lines). If not valid, try TD1 (3 lines)
    let parsed = null;
    if (lines.length >= 2) {
      parsed = parseTD3(lines);
    }
    if (!parsed && lines.length >= 3) {
      parsed = parseTD1(lines);
    }

    res.json({
      rawText: fullText,
      mrzLines: lines,
      parsed, // structured fields (TD3/TD1) with check digit validation flags
    });
  } catch (err) {
    console.error("Vision OCR error:", err);
    res.status(500).json({ error: "OCR failed", details: String(err) });
  } finally {
    // Cleanup temps
    for (const p of tempPaths) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  }
});

app.get("/test", (_, res) => res.json({ ok: true }));

app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});
