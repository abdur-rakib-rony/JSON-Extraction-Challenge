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

const correctCommonOcrErrors = (text: string): string => {
  return text
    .replace(/[Ii](?=-\d)/g, '1')
    .replace(/I(?=\d)/g, '1')
    .replace(/l(?=\d)/g, '1')
    .replace(/O(?=\d)/g, '0')
    .replace(/o(?=\d)/g, '0')
    .replace(/S(?=outh)/g, 'S')
    .replace(/Sout[hn]/g, 'South')
    .replace(/0rganization/g, 'Organization')
    .replace(/[Bb]0yer/g, 'Boyer')
    .replace(/\b[Xx]\b/g, 'x')
    .replace(/\bx(\d+)\b/g, 'x$1')
    .replace(/\b(\d+)x(\d+)\b/g, '$1 x$2')
    .replace(/\b(\d+)[.:\/\\](\d+)[.:\/\\](\d+)\b/g, '$1-$2-$3');
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

const isSimilar = (str1: string, str2: string, threshold = 0.8): boolean => {
  if (!str1 || !str2) return false;

  const s1 = str1.toLowerCase().trim().replace(/\s+/g, ' ');
  const s2 = str2.toLowerCase().trim().replace(/\s+/g, ' ');
  
  if (s1 === s2) return true;
  
  const normalized1 = s1
    .replace(/[i1l]/g, 'i')
    .replace(/[o0]/g, 'o')
    .replace(/[5s]/g, 's')
    .replace(/[8b]/g, 'b')
    .replace(/[9g]/g, 'g');
    
  const normalized2 = s2
    .replace(/[i1l]/g, 'i')
    .replace(/[o0]/g, 'o')
    .replace(/[5s]/g, 's')
    .replace(/[8b]/g, 'b')
    .replace(/[9g]/g, 'g');
  
  if (normalized1 === normalized2) return true;
  
  const longer = normalized1.length > normalized2.length ? normalized1 : normalized2;
  const shorter = normalized1.length > normalized2.length ? normalized2 : normalized1;
  
  if (longer.length === 0) return shorter.length === 0;
  if (longer.length - shorter.length > longer.length * (1 - threshold)) return false;
  
  const distances: number[][] = Array(shorter.length + 1).fill(null).map(() => 
    Array(longer.length + 1).fill(null));
  
  for (let i = 0; i <= shorter.length; i++) distances[i][0] = i;
  for (let j = 0; j <= longer.length; j++) distances[0][j] = j;
  
  for (let i = 1; i <= shorter.length; i++) {
    for (let j = 1; j <= longer.length; j++) {
      const cost = shorter[i - 1] === longer[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost
      );
    }
  }
  
  const similarity = 1 - distances[shorter.length][longer.length] / longer.length;
  return similarity >= threshold;
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
    new RegExp(`${fieldName}[:\\s]+([\\w\\s-\\.&,]+)(?=[a-zA-Z]{3,}:|[\\},])`, 'g'),
    new RegExp(`\\b${fieldName}\\b[^:]*?:\\s*"?([^",\\r\\n}]+)"?`, 'gi')
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

const extractName = (text: string): string[] => {
  const patterns = [
    /"name"\s*:\s*"([^"]+)"/gi,
    /name\s*[:=]\s*"?([A-Z][a-zA-Z\s\.-]+(?:-[A-Z][a-zA-Z\s\.-]+)?)"?/gi,
    /Dr\.\s+([A-Z][a-z]+(?:-[A-Z][a-z]+)?\s+[A-Z][a-z\-]+)/gi,
    /Mr\.\s+([A-Z][a-z]+(?:-[A-Z][a-z]+)?\s+[A-Z][a-z\-]+)/gi,
    /Mrs\.\s+([A-Z][a-z]+(?:-[A-Z][a-z]+)?\s+[A-Z][a-z\-]+)/gi,
    /Ms\.\s+([A-Z][a-z]+(?:-[A-Z][a-z]+)?\s+[A-Z][a-z\-]+)/gi,
    /"name"\s*:([^"]{2,30})[,}]/gi,
    /name\s*:([^"]{2,30})[,}]/gi,
    /["']\s*name\s*["']\s*:\s*["']([^"']+)["']/gi
  ];
  
  const results: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && match[1].trim()) {
        results.push(match[1].trim().replace(/["']/g, ''));
      }
    }
  }
  return results;
};

const extractOrganization = (text: string): string[] => {
  const patterns = [
    /"organization"\s*:\s*"([^"]+)"/gi,
    /organization\s*[:=]\s*"?([A-Za-z0-9\s\-&]+(?:\s+(?:Group|LLC|Inc|Corp|Corporation|Company|Co\.|Ltd\.)))"?/gi,
    /organization\s*[:=]\s*"?([A-Za-z0-9\s\-&]+)"?/gi,
    /([A-Za-z]+\s+(?:Group|LLC|Inc|Corp|Corporation|Company|Co\.|Ltd\.))/gi,
    /([A-Za-z]+\s*[\-&]\s*[A-Za-z]+)/gi,
    /"organization"\s*:([^"]{2,30})[,}]/gi,
    /organization\s*:([^"]{2,30})[,}]/gi,
    /["']\s*organization\s*["']\s*:\s*["']([^"']+)["']/gi,
    /\b([A-Za-z]+\s+Group)\b/gi,
    /\b([A-Za-z]+-[A-Za-z]+)\b/gi
  ];
  
  const results: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && match[1].trim()) {
        results.push(match[1].trim().replace(/["']/g, ''));
      }
    }
  }
  return results;
};

const extractAddress = (text: string): string[] => {
  const patterns = [
    /"address"\s*:\s*"([^"]+)"/gi,
    /address\s*[:=]\s*"?(\d+\s+[A-Za-z]+(?:\s+[A-Za-z]+)*(?:\s*,\s*[A-Za-z]+(?:\s+[A-Za-z]+)*))"?/gi,
    /(\d+\s+[A-Za-z]+\s+(?:Hills|Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Terrace|Ter|Place|Pl|Boulevard|Blvd)(?:\s*,\s*[A-Za-z]+(?:\s+[A-Za-z]+)*))/gi,
    /(\d+\s+[NSEW]\.?\s+\d+[a-z]+\s+[A-Za-z]+(?:\s*,\s*[A-Za-z]+(?:\s+[A-Za-z]+)*))/gi,
    /"address"\s*:([^"]{5,50})[,}]/gi,
    /address\s*:([^"]{5,50})[,}]/gi,
    /["']\s*address\s*["']\s*:\s*["']([^"']+)["']/gi,
    /\b(\d+\s+[A-Za-z]+\s+[A-Za-z]+,\s*[A-Za-z]+)\b/gi,
    /\b(\d+\s+[A-Za-z]+\s+[A-Za-z]+\s*,\s*[A-Za-z]+\s+[A-Za-z]+)\b/gi
  ];
  
  const results: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && match[1].trim()) {
        results.push(match[1].trim().replace(/["']/g, ''));
      }
    }
  }
  return results;
};

const extractMobile = (text: string): string[] => {
  const patterns = [
    /"mobile"\s*:\s*"([^"]+)"/gi,
    /mobile\s*[:=]\s*"?((?:1-)?[0-9]{3}[-.\s][0-9]{3}[-.\s][0-9]{4}(?:\s*x[0-9]+)?)"?/gi,
    /((?:1-)?[0-9]{3}[-.\s][0-9]{3}[-.\s][0-9]{4}(?:\s*x[0-9]+)?)/gi,
    /(\(\d{3}\)\s*\d{3}[-.\s]\d{4}(?:\s*x\d+)?)/gi,
    /"mobile"\s*:([^"]{7,20})[,}]/gi,
    /mobile\s*:([^"]{7,20})[,}]/gi,
    /["']\s*mobile\s*["']\s*:\s*["']([^"']+)["']/gi,
    /\b(1-\d{3}-\d{3}-\d{4}(?:\s*x\d+)?)\b/gi,
    /\b(\d{3}[.-]\d{3}[.-]\d{4}(?:\s*x\d+)?)\b/gi,
    /\b(\d{3}[-.\s]\d{3}[-.\s]\d{4}\s*(?:x\d+)?)\b/gi
  ];
  
  const results: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] && match[1].trim()) {
        results.push(match[1].trim().replace(/["']/g, ''));
      }
    }
  }
  return results;
};

const tryParseJson = (text: string): ExtractedData | null => {
  const jsonPattern = /\{(?:[^{}]|"[^"]*")*"name"(?:[^{}]|"[^"]*")*"organization"(?:[^{}]|"[^"]*")*"address"(?:[^{}]|"[^"]*")*"mobile"(?:[^{}]|"[^"]*")*\}/i;
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
  
  const simpleJsonPattern = /\{[^{}]*\}/g;
  let match;
  while ((match = simpleJsonPattern.exec(text)) !== null) {
    try {
      const potentialJson = match[0]
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
        .replace(/:\s*(['"])?([^'"{}[\],\s]+)(['"])?([,}])/g, ':"$2"$4');
      
      const data = JSON.parse(potentialJson);
      if (data.name && data.organization && data.address && data.mobile) {
        return {
          name: data.name,
          organization: data.organization,
          address: data.address,
          mobile: data.mobile
        };
      }
    } catch (e) {
      // Continue to next match
    }
  }
  
  return null;
};

const extractRawData = (text: string, originalText: string): ExtractedData | null => {
  const nameValues = extractName(text);
  const orgValues = extractOrganization(text);
  const addressValues = extractAddress(text);
  const mobileValues = extractMobile(text);
  
  if (nameValues.length > 0 && orgValues.length > 0 && 
      addressValues.length > 0 && mobileValues.length > 0) {
    return {
      name: nameValues[0],
      organization: orgValues[0],
      address: addressValues[0],
      mobile: mobileValues[0]
    };
  }
  
  const genericNameValues = extractFieldValues(text, "name");
  const genericOrgValues = extractFieldValues(text, "organization");
  const genericAddressValues = extractFieldValues(text, "address");
  const genericMobileValues = extractFieldValues(text, "mobile");
  
  if (genericNameValues.length > 0 && genericOrgValues.length > 0 && 
      genericAddressValues.length > 0 && genericMobileValues.length > 0) {
    return {
      name: genericNameValues[0],
      organization: genericOrgValues[0],
      address: genericAddressValues[0],
      mobile: genericMobileValues[0]
    };
  }
  
  nameValues.push(...extractFieldValues(originalText, "name"));
  orgValues.push(...extractFieldValues(originalText, "organization"));
  addressValues.push(...extractFieldValues(originalText, "address"));
  mobileValues.push(...extractFieldValues(originalText, "mobile"));
  
  if (nameValues.length > 0 && orgValues.length > 0 && 
      addressValues.length > 0 && mobileValues.length > 0) {
    return {
      name: nameValues[0],
      organization: orgValues[0],
      address: addressValues[0],
      mobile: mobileValues[0]
    };
  }
  
  const lastResortName = text.match(/[A-Z][a-z]+(?:[-\s][A-Z][a-z]+){1,2}/);
  const lastResortOrg = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Group|LLC|Inc|Company)/i);
  const lastResortAddress = text.match(/\d+\s+[A-Za-z\s\.]+,\s*[A-Za-z\s]+/);
  const lastResortMobile = text.match(/(?:1-)?[0-9]{3}[-.\s][0-9]{3}[-.\s][0-9]{4}(?:\s*x[0-9]+)?/);
  
  if (lastResortName && lastResortOrg && lastResortAddress && lastResortMobile) {
    return {
      name: lastResortName[0],
      organization: lastResortOrg[0],
      address: lastResortAddress[0],
      mobile: lastResortMobile[0]
    };
  }
  
  return null;
};

const findExactMatch = (extractedData: ExtractedData, originalText: string): ExtractedData => {
  const result = {...extractedData};
  
  const nameMatches = extractName(originalText);
  const orgMatches = extractOrganization(originalText);
  const addressMatches = extractAddress(originalText);
  const mobileMatches = extractMobile(originalText);
  
  if (nameMatches.length > 0) {
    const exactMatch = nameMatches.find(name => name === extractedData.name);
    if (exactMatch) {
      result.name = exactMatch;
    } else {
      const mostSimilar = nameMatches.reduce((prev, curr) => 
        isSimilar(curr, extractedData.name) ? curr : prev, extractedData.name);
      result.name = mostSimilar;
    }
  }
  
  if (orgMatches.length > 0) {
    const exactMatch = orgMatches.find(org => org === extractedData.organization);
    if (exactMatch) {
      result.organization = exactMatch;
    } else {
      const mostSimilar = orgMatches.reduce((prev, curr) => 
        isSimilar(curr, extractedData.organization) ? curr : prev, extractedData.organization);
      result.organization = mostSimilar;
    }
  }
  
  if (addressMatches.length > 0) {
    const exactMatch = addressMatches.find(addr => addr === extractedData.address);
    if (exactMatch) {
      result.address = exactMatch;
    } else {
      const mostSimilar = addressMatches.reduce((prev, curr) => 
        isSimilar(curr, extractedData.address) ? curr : prev, extractedData.address);
      result.address = mostSimilar;
    }
  }
  
  if (mobileMatches.length > 0) {
    const exactMatch = mobileMatches.find(mobile => mobile === extractedData.mobile);
    if (exactMatch) {
      result.mobile = exactMatch;
    } else {
      const mostSimilar = mobileMatches.reduce((prev, curr) => 
        isSimilar(curr, extractedData.mobile) ? curr : prev, extractedData.mobile);
      result.mobile = mostSimilar;
    }
  }
  
  result.name = result.name.replace(/l(?=-)/g, 'I');
  result.address = result.address.replace(/Sout[hn]/g, 'South');
  result.mobile = result.mobile.replace(/[Ii]-/g, '1-');
  
  return result;
};

const extractData = (text: string): ExtractedData | null => {
  const originalText = text;
  const normalizedText = normalizeText(text);
  const correctedText = correctCommonOcrErrors(normalizedText);
  
  const jsonData = tryParseJson(correctedText);
  if (jsonData) {
    return findExactMatch(jsonData, originalText);
  }
  
  const rawData = extractRawData(correctedText, originalText);
  if (rawData) {
    return findExactMatch(rawData, originalText);
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