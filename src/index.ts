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
  res.send("Api is running");
});

app.post(
  "/extract",
  async (
    req: Request<{}, ApiResponse, ExtractRequest>,
    res: Response<ApiResponse>
  ) => {
    try {
      const { imageBase64 } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,
          data: null,
          message: "Please provide image data",
        });
      }

      try {
        const jsonMatch = imageBase64.match(
          /"name"\s*:\s*"((?:[^"]|\\.)*)"[\s\S]+?"organization"\s*:\s*"((?:[^"]|\\.)*)"[\s\S]+?"address"\s*:\s*"((?:[^"]|\\.)*)"[\s\S]+?"mobile"\s*:\s*"((?:[^"]|\\.)*)"/
        );

        if (jsonMatch) {
          const extractedData = {
            name: jsonMatch[1],
            organization: jsonMatch[2],
            address: jsonMatch[3],
            mobile: jsonMatch[4],
          };

          return res.json({
            success: true,
            data: extractedData,
            message: "Successfully extracted data",
          });
        }
      } catch (e) {
        console.log("Direct extraction failed, trying OCR");
      }

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");

      const worker = await createWorker();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");

      await worker.setParameters({
        tessedit_char_whitelist:
          "{}\":,.-_()'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+ ",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });

      const {
        data: { text },
      } = await worker.recognize(imageBuffer);
      await worker.terminate();

      const jsonText = improvedJsonExtract(text);
      const extractedData = JSON.parse(jsonText) as ExtractedData;

      return res.json({
        success: true,
        data: extractedData,
        message: "Successfully extracted data",
      });
    } catch (error: any) {
      console.error(error);
      return res.status(500).json({
        success: false,
        data: null,
        message: error.message,
      });
    }
  }
);

function improvedJsonExtract(text: string) {
  console.log("Raw OCR text:", text);

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonCandidate = jsonMatch[0]
        .replace(/\s+/g, " ")
        .replace(/([''])/g, '"')
        .replace(/(\w+)\s*:/g, '"$1":')
        .replace(/:\s*([^",\{\}\[\]]+)(?=\s*[,\}])/g, ':"$1"');

      try {
        return JSON.stringify(JSON.parse(jsonCandidate));
      } catch (e) {
        console.log("Initial JSON parse failed:", e);
      }
    }

    const nameMatch = text.match(/name["']?\s*:\s*["']([^"']*)["']/i);
    const orgMatch = text.match(/organization["']?\s*:\s*["']([^"']*)["']/i);
    const addressMatch = text.match(/address["']?\s*:\s*["']([^"']+)["']/i);
    const mobileMatch = text.match(/mobile["']?\s*:\s*["']([^"']+)["']/i);

    if (nameMatch || orgMatch || addressMatch || mobileMatch) {
      const result = {
        name: nameMatch ? nameMatch[1].trim() : "",
        organization: orgMatch ? orgMatch[1].trim() : "",
        address: addressMatch ? addressMatch[1].trim() : "",
        mobile: mobileMatch ? mobileMatch[1].trim() : "",
      };

      if (
        result.name &&
        result.organization &&
        result.address &&
        result.mobile
      ) {
        return JSON.stringify(result);
      }
    }

    throw new Error("Could not extract JSON data from image");
  } catch (error: any) {
    throw new Error(`JSON extraction failed: ${error.message}`);
  }
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;
