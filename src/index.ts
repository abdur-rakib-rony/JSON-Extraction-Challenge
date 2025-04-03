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
      JSON.parse(standardMatch[0]);
      return standardMatch[0];
    } catch (e) {
      console.log("cleanup for parsing failed");
    }
  }

  try {
    let cleanText = text.replace(/[^\{\}\"\:\,\.\-\_a-zA-Z0-9\+\s]/g, "");

    const flexMatch = cleanText.match(/\{[\s\S]*\}/);
    if (flexMatch) {
      let jsonCandidate = flexMatch[0];

      jsonCandidate = jsonCandidate
        .replace(/["]+/g, '"')
        .replace(/[']/g, '"')
        .replace(/[`]/g, '"')
        .replace(/(\w+):/g, '"$1":')
        .replace(/:\s*"([^"]*)(\s*)$/gm, ': "$1",')
        .replace(/,\s*\}/g, "}")
        .replace(/"\s*\{/g, '{"')
        .replace(/\}\s*"/g, ',"')
        .replace(/\}\s*\{/g, "},{");

      JSON.parse(jsonCandidate);
      return jsonCandidate;
    }

    const nameMatch = text.match(/name[^a-zA-Z0-9]+(["']?)([^"']+)\1/i);
    const orgMatch = text.match(/organization[^a-zA-Z0-9]+(["']?)([^"']+)\1/i);
    const addressMatch = text.match(/address[^a-zA-Z0-9]+(["']?)([^"']+)\1/i);
    const mobileMatch = text.match(/mobile[^a-zA-Z0-9]+(["']?)([^"']+)\1/i);

    if (nameMatch || orgMatch || addressMatch || mobileMatch) {
      const constructedJson = {
        name: nameMatch ? nameMatch[2] : "",
        organization: orgMatch ? orgMatch[2] : "",
        address: addressMatch ? addressMatch[2] : "",
        mobile: mobileMatch ? mobileMatch[2] : "",
      };

      return JSON.stringify(constructedJson);
    }

    throw new Error("invalid json pattern");
  } catch (error: any) {
    throw new Error(error.message);
  }
}

app.listen(port, () => {
  console.log(port);
});

export default app;
