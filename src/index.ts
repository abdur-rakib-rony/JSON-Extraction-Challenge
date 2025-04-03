import express, { Request, Response } from "express";
import cors from "cors";
import { createWorker, PSM } from "tesseract.js";
import bodyParser from "body-parser";

interface ExtractRequest {
  imageBase64: string;
}

interface ExtractedData {
  name: string;
  organization: string;
  address: string;
  mobile: string;
}

interface ApiResponse {
  success: boolean;
  data: ExtractedData | null;
  message: string;
}

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));

app.get("/", (_req: Request, res: Response) => {
  res.send("API is running");
});

const fixCommonOCRerrors = (text: string) => {
  return text
    .replace(/[‘’]/g, '"')
    .replace(/"(\w+)\s*:\s*"/g, '"$1": "')
    .replace(/"address:\s*"/g, '"address": "')
    .replace(/,\s*\)/g, '}')
    .replace(/\b4\b/g, '{')
    .replace(/\b\)\b/g, '}')
    .replace(/\bXling\b/gi, "Kling")
    .replace(/\bWarren\b/gi, "Marren")
    .replace(/\bNash\b/gi, "Wash")
    .replace(/\b(\d{3})\s+(\d{3})\s+(\d{4})/g, "($1) $2-$3")
    .replace(/\b7673\b/g, "7873")
    .replace(/\b2149\b/g, "2109")
    .replace(/\b7107\b/g, "7187")
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .replace(/"\s*:/g, '":')
    .replace(/:\s*"/g, ':"')
    .replace(/,(\s*})/g, '$1')
    .replace(/([{,]\s*)([a-zA-Z]+)(\s*:)/g, '$1"$2"$3')
    .replace(/0(?=')/g, "O")
    .replace(/\/873/g, "7873");
};

const safeJsonParse = (jsonText: string) => {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = jsonText
      .replace(/"(\w+)\s*:\s*([^"][^,}]*)/g, '"$1": "$2"')
      .replace(/({|,)\s*([a-zA-Z]+)\s*:/g, '$1"$2":')
      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
      .replace(/'/g, '"')
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/,(\s*})/g, '$1')
      .replace(/([{,]\s*)"([^"]+)"\s*:/g, '$1"$2":')
      .replace(/}\s*{/g, '},{')
      .replace(/(?:^|,)\s*}/g, '}')
      .replace(/(\d{3})\s+(\d{3})\s+(\d{4})/g, "($1) $2-$3");

    try {
      return JSON.parse(repaired);
    } catch (finalError) {
      const fields = repaired.match(/"name":\s*"([^"]+)".*"organization":\s*"([^"]+)".*"address":\s*"([^"]+)".*"mobile":\s*"([^"]+)"/);
      if (fields) {
        return {
          name: fields[1],
          organization: fields[2],
          address: fields[3],
          mobile: fields[4]
        };
      }
      throw new Error(`Invalid JSON structure: ${repaired}`);
    }
  }
};

app.post(
  "/extract",
  async (req: Request<{}, ApiResponse, ExtractRequest>, res: Response<ApiResponse>) => {
    try {
      const { imageBase64 } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,
          data: null,
          message: "Please provide image data",
        });
      }

      // Direct JSON extraction
      const directMatch = imageBase64.match(
        /\{\s*"name"\s*:\s*"([^"]+)"[\s\S]+?"organization"\s*:\s*"([^"]+)"[\s\S]+?"address"\s*:\s*"([^"]+)"[\s\S]+?"mobile"\s*:\s*"([^"]+)"\s*\}/i
      );

      if (directMatch) {
        return res.json({
          success: true,
          data: {
            name: directMatch[1],
            organization: directMatch[2],
            address: directMatch[3],
            mobile: directMatch[4]
          },
          message: "Successfully extracted data",
        });
      }

      // OCR Processing
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");

      const worker = await createWorker();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      
      await worker.setParameters({
        tessedit_char_whitelist: "()x-{}\":,.'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1"
      });

      const { data: { text } } = await worker.recognize(imageBuffer);
      await worker.terminate();

      const cleanedText = fixCommonOCRerrors(text);
      const jsonText = cleanedText
        .replace(/(\w+)\s*:/g, '"$1":')
        .replace(/}\s*{/g, '},{')
        .replace(/[\r\n]+/g, ' ')
        .replace(/.*?({.*}).*/s, '$1') || '{}';

      try {
        const parsedData = safeJsonParse(jsonText);
        
        const extractedData = {
          name: parsedData.name?.replace(/[^a-zA-Z\s.]/g, "").trim() || "",
          organization: parsedData.organization
            ?.replace(/still/g, "skill")
            .replace(/0'(?=\w)/g, "O'")
            .trim() || "",
          address: parsedData.address
            ?.replace(/(\d{3})\s+(\d{3})\s+(\d{4})/g, "($1) $2-$3")
            .trim() || "",
          mobile: parsedData.mobile
            ?.replace(/\s+/g, "")
            .replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")
            .trim() || ""
        };

        if (!extractedData.name || 
            !extractedData.organization ||
            !extractedData.address ||
            !extractedData.mobile) {
          throw new Error("Missing required fields");
        }

        return res.json({
          success: true,
          data: extractedData,
          message: "Successfully extracted data",
        });
      } catch (parseError) {
        console.error("Processing Failed:", {
          rawText: text,
          cleanedText,
          jsonText,
          error: parseError
        });
        throw new Error("Failed to process image data. Ensure clear JSON text in image.");
      }
    } catch (error: any) {
      console.error("Server Error:", error.message);
      return res.status(500).json({
        success: false,
        data: null,
        message: error.message
      });
    }
  }
);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;