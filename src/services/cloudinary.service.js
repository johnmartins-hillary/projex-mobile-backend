const crypto = require("crypto");
const { logger } = require("../utils/logger");

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
  process.env;

/**
 * Generate a signed upload signature for direct client → Cloudinary uploads.
 * The client uses this to POST directly to Cloudinary without exposing the secret.
 */
const generateSignature = (folder = "projex/documents") => {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, timestamp };

  // Build param string: key=value pairs sorted alphabetically, joined with &
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const signature = crypto
    .createHash("sha256")
    .update(paramString + CLOUDINARY_API_SECRET)
    .digest("hex");

  return {
    signature,
    timestamp,
    apiKey: CLOUDINARY_API_KEY,
    cloudName: CLOUDINARY_CLOUD_NAME,
    folder,
  };
};

/**
 * Delete one or more assets from Cloudinary by public_id.
 * Called after DB records are removed.
 */
const deleteAsset = async (publicId) => {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const paramString = `public_id=${publicId}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash("sha256")
      .update(paramString + CLOUDINARY_API_SECRET)
      .digest("hex");

    const body = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: CLOUDINARY_API_KEY,
      signature,
    });

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/destroy`,
      { method: "POST", body },
    );

    const data = await res.json();
    if (data.result !== "ok") {
      logger.warn(`Cloudinary delete soft-failed for ${publicId}:`, data);
    }
    return data;
  } catch (err) {
    // Non-fatal — log and continue. DB record is already gone.
    logger.error(`Cloudinary delete error for ${publicId}:`, err.message);
  }
};

const deleteAssets = async (publicIds = []) => {
  await Promise.all(publicIds.map(deleteAsset));
};

module.exports = { generateSignature, deleteAsset, deleteAssets };
