import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  console.log("webhook reached", {
    method: req.method,
    url: req.url,
  });

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  res.status(200).send("OK");
}
