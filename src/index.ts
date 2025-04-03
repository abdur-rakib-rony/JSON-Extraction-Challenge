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
          message: "please provide image data",
        });
      }

      const base64Data = imageBase64.replace(/^data:image\/png;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");

      const worker = await createWorker();
      await worker.loadLanguage("eng");
      await worker.initialize("eng");

      await worker.setParameters({
        tessedit_char_whitelist:
          '{}":,.-_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+',
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
        message: "successfully extracted data",
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

function improvedJsonExtract(text: string): string {
  const standardMatch = text.match(/\{[\s\S]*\}/);
  if (standardMatch) {
    try {
      const jsonObj = JSON.parse(standardMatch[0]);
      return JSON.stringify(jsonObj);
    } catch (e) {
      console.log(e);
    }
  }

  try {
    const nameRegex = /"name"\s*:\s*"([^"]*)"/;
    const orgRegex = /"organization"\s*:\s*"([^"]*)"/;
    const addressRegex = /"address"\s*:\s*"([^"]*)"/;
    const mobileRegex = /"mobile"\s*:\s*"([^"]*)"/;

    const nameMatch = text.match(nameRegex);
    const orgMatch = text.match(orgRegex);
    const addressMatch = text.match(addressRegex);
    const mobileMatch = text.match(mobileRegex);

    if (nameMatch && orgMatch && addressMatch && mobileMatch) {
      const constructedJson = {
        name: nameMatch[1],
        organization: orgMatch[1],
        address: addressMatch[1],
        mobile: mobileMatch[1],
      };

      return JSON.stringify(constructedJson);
    }

    throw new Error("Invalid JSON pattern");
  } catch (error: any) {
    throw new Error(error.message);
  }
}

app.listen(port, () => {
  console.log(port);
});

export default app;
