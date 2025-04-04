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

// Comprehensive text normalization
const normalizeText = (text: string): string => {
  return text
    .replace(/[\r\n]+/g, " ")        
    .replace(/\s+/g, " ")           
    .replace(/\b([4I])\b/g, '{')    
    .replace(/\b([1I])\b/g, 'I')    
    .replace(/\b(\))\b/g, '}')       
    .replace(/['`´']/g, '"')         
    .replace(/\\/g, "")           
    .trim();                      
};

const fixJsonStructure = (text: string): string => {
  let fixed = text;
  
  fixed = fixed
    .replace(/"name"?\s*:(\s*[^"{][^,}]*[^"}]),/g, '"name":"$1",')
    .replace(/"organization"?\s*:(\s*[^"{][^,}]*[^"}]),/g, '"organization":"$1",')
    .replace(/"address"?\s*:(\s*[^"{][^,}]*[^"}]),/g, '"address":"$1",')
    .replace(/"mobile"?\s*:(\s*[^"{][^,}]*[^"}]),/g, '"mobile":"$1",')
    .replace(/"name"?\s*:(\s*[^"{][^,}]*[^"}])\s*}/g, '"name":"$1"}')
    .replace(/"organization"?\s*:(\s*[^"{][^,}]*[^"}])\s*}/g, '"organization":"$1"}')
    .replace(/"address"?\s*:(\s*[^"{][^,}]*[^"}])\s*}/g, '"address":"$1"}')
    .replace(/"mobile"?\s*:(\s*[^"{][^,}]*[^"}])\s*}/g, '"mobile":"$1"}');
  
  fixed = fixed
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')  
    .replace(/([{,]\s*)"([^"]+)"(\s*[:])\s*([^",{}\[\]\s][^,}]*?)([,}])/g, '$1"$2"$3"$4"$5')  
    .replace(/([{,]\s*)"([^"]+)"(\s*[:])\s*([^",{}\[\]\s][^,}]*?)$/g, '$1"$2"$3"$4"')  
    .replace(/"address:\s*"/g, '"address":"')  
    .replace(/"organization:\s*"/g, '"organization":"')  
    .replace(/"name:\s*"/g, '"name":"')  
    .replace(/"mobile:\s*"/g, '"mobile":"')  
    .replace(/,\s*}/g, '}')  
    .replace(/",([^"])/g, '","$1')  
    .replace(/([^"])":/g, '$1":')  
    .replace(/"([^"]*?)([,}])/g, '"$1"$2')  
    .replace(/}([^{}"'\s,])/g, '},"$1') 
    .replace(/}\s*{/g, '},{');
    
  return fixed;
};

const extractFieldValues = (text: string, fieldName: string): string[] => {
  const strategies = [
    new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`, 'g'),
    
    new RegExp(`${fieldName}\\s*:\\s*"([^"]+)"`, 'g'),
    
    new RegExp(`"${fieldName}"\\s*:\\s*([^",}{]+)`, 'g'),
    
    new RegExp(`${fieldName}\\s*:\\s*([^",}{]+)`, 'g'),
    
    new RegExp(`"${fieldName}"\\s+["']?([^"'}{,]+)["']?`, 'g'),
    
    new RegExp(`${fieldName}\\s+["']?([^"'}{,]+)["']?`, 'g'),
    
    new RegExp(`["{]?\\s*${fieldName}\\s*["}]?\\s*[:=]\\s*["']([^"']+)["']`, 'g'),
    
    new RegExp(`${fieldName}[:\\s]+([\\w\\s-\\.&,]+)(?=[a-zA-Z]{3,}:|[\\},])`, 'g')
  ];
  
  const results: string[] = [];
  
  for (const regex of strategies) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1] && match[1].trim()) {
        results.push(match[1].trim());
      }
    }
  }
  
  return results;
};

const extractSpecificPatterns = (text: string): Partial<ExtractedData> => {
  const result: Partial<ExtractedData> = {};
  
  const namePatterns = [
    /Dr\.\s+([A-Z][a-z]+\s+[A-Z][a-z\-]+)/,
    /Mr\.\s+([A-Z][a-z]+\s+[A-Z][a-z\-]+)/,
    /Mrs\.\s+([A-Z][a-z]+\s+[A-Z][a-z\-]+)/,
    /Ms\.\s+([A-Z][a-z]+\s+[A-Z][a-z\-]+)/,
    /name\s*[:=]?\s*["']?([A-Z][a-z]+\s+[A-Z][a-z\-]+)["']?/i,
    /["']?([A-Z][a-z]+\s+[A-Z][a-z\-]+)["']?\s*,\s*["']?([A-Za-z\s&\-]+)["']?/
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.name = match[1].trim();
      break;
    }
  }
  
  const orgPatterns = [
    /organization\s*[:=]?\s*["']?([A-Za-z0-9\s\-&]+)["']?/i,
    /([A-Za-z]+\s+(?:Group|LLC|Inc|Corp|Corporation|Company))/,
    /([A-Za-z]+\s*[\-&]\s*[A-Za-z]+)/
  ];
  
  for (const pattern of orgPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.organization = match[1].trim();
      break;
    }
  }
  
  const addressPatterns = [
    /address\s*[:=]?\s*["']?(\d+\s+[A-Za-z\.\s]+,\s*[A-Za-z]+)["']?/i,
    /(\d+\s+[NSEW]\.?\s+\d+[a-z]+\s+[A-Za-z]+,\s*[A-Za-z]+)/,
    /(\d+\s+[A-Za-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Terrace|Ter|Place|Pl|Boulevard|Blvd),\s*[A-Za-z]+)/i
  ];
  
  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.address = match[1].trim();
      break;
    }
  }
  
  const mobilePatterns = [
    /mobile\s*[:=]?\s*["']?(\d{3}[\.\-\s]\d{3}[\.\-\s]\d{4}(?:\s*x\d+)?)["']?/i,
    /(\d{3}[\.\-\s]\d{3}[\.\-\s]\d{4}(?:\s*x\d+)?)/,
    /(\(\d{3}\)\s*\d{3}[\.\-\s]\d{4}(?:\s*x\d+)?)/,
    /(1[\.\-\s]\d{3}[\.\-\s]\d{3}[\.\-\s]\d{4}(?:\s*x\d+)?)/
  ];
  
  for (const pattern of mobilePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.mobile = match[1].trim();
      break;
    }
  }
  
  return result;
};

const tryParseJson = (text: string): ExtractedData | null => {
  const jsonPattern = /\{[^{}]*"name"[^{}]*"organization"[^{}]*"address"[^{}]*"mobile"[^{}]*\}/i;
  const jsonMatch = text.match(jsonPattern);
  
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[0]);
      if (data.name && data.organization && data.address && data.mobile) {
        return {
          name: data.name,
          organization: data.organization,
          address: data.address,
          mobile: data.mobile
        };
      }
    } catch (e) {
      try {
        const fixedJson = fixJsonStructure(jsonMatch[0]);
        const data = JSON.parse(fixedJson);
        if (data.name && data.organization && data.address && data.mobile) {
          return {
            name: data.name,
            organization: data.organization,
            address: data.address,
            mobile: data.mobile
          };
        }
      } catch (e2) {
        console.error("Fixed JSON parsing failed:", e2);
      }
    }
  }
  return null;
};

const extractData = (text: string): ExtractedData | null => {
  const normalizedText = normalizeText(text);
  
  const jsonData = tryParseJson(normalizedText);
  if (jsonData) {
    return jsonData;
  }
  
  const nameValues = extractFieldValues(normalizedText, "name");
  const orgValues = extractFieldValues(normalizedText, "organization");
  const addressValues = extractFieldValues(normalizedText, "address");
  const mobileValues = extractFieldValues(normalizedText, "mobile");
  
  if (nameValues.length > 0 && orgValues.length > 0 && 
      addressValues.length > 0 && mobileValues.length > 0) {
    return {
      name: nameValues[0],
      organization: orgValues[0],
      address: addressValues[0],
      mobile: mobileValues[0]
    };
  }
  
  const patternData = extractSpecificPatterns(normalizedText);
  if (patternData.name && patternData.organization && 
      patternData.address && patternData.mobile) {
    return {
      name: patternData.name,
      organization: patternData.organization,
      address: patternData.address,
      mobile: patternData.mobile
    };
  }
  
  const result: ExtractedData = {
    name: nameValues[0] || patternData.name || "",
    organization: orgValues[0] || patternData.organization || "",
    address: addressValues[0] || patternData.address || "",
    mobile: mobileValues[0] || patternData.mobile || ""
  };
  
  if (result.name && result.organization && result.address && result.mobile) {
    return result;
  }
  
  return null;
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

      const directResult = extractData(imageBase64);
      if (directResult) {
        console.log("Direct extraction successful:", directResult);
        return res.json({
          success: true,
          data: directResult,
          message: "Successfully extracted data directly from input",
        });
      }

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

      console.log("OCR Raw Text:", text);
      
      const extractedData = extractData(text);
      
      if (!extractedData) {
        const aggressivelyFixed = fixJsonStructure(normalizeText(text));
        console.log("Aggressively fixed text:", aggressivelyFixed);
        
        const lastResortData = extractData(aggressivelyFixed);
        if (lastResortData) {
          return res.json({
            success: true,
            data: lastResortData,
            message: "Successfully extracted data using aggressive fixing",
          });
        }
        
        throw new Error("Failed to extract required data from the image");
      }
      
      return res.json({
        success: true,
        data: extractedData,
        message: "Successfully extracted data",
      });
    } catch (error: any) {
      console.error("Error:", error.message);
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