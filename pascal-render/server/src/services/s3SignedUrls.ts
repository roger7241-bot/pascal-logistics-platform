// ============================================================================
// S3-KMS SIGNED DOWNLOAD URLS — Document Vault
// Real AWS SDK v3 usage, real 15-minute presigned URLs with SSE-KMS when
// credentials + a bucket are configured. HONEST LIMITATION: this
// environment has none configured, and — separately — vault_documents has
// no real file-upload path yet (see the schema.sql comment above the
// s3_key column), so this only produces a genuinely working link for
// documents that already carry a real key. Absent credentials, falls back
// to the same logged-simulation pattern used by sendDriverSms and
// sendOperationalEmail elsewhere in this codebase, rather than throwing or
// silently returning a broken link.
// ============================================================================

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes, per spec

const hasAwsCreds = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.DOCUMENT_VAULT_BUCKET);
const s3Client = hasAwsCreds ? new S3Client({ region: process.env.AWS_REGION ?? "us-west-2" }) : undefined;

export interface SignedUrlResult {
  url: string;
  simulated: boolean;
  expiresInSeconds: number;
  expiresAtIso: string;
}

export async function generateVaultDownloadUrl(objectKey: string): Promise<SignedUrlResult> {
  const expiresAtIso = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

  if (!s3Client) {
    console.log(`[SIMULATED S3 SIGNED URL — no AWS credentials/bucket configured] key: ${objectKey}`);
    return { url: `https://simulated-vault.example.com/${encodeURIComponent(objectKey)}`, simulated: true, expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS, expiresAtIso };
  }

  try {
    // SSE-KMS is enforced at upload time (PutObjectCommand) or via bucket
    // policy — GetObjectCommand has no ServerSideEncryption parameter;
    // S3 decrypts transparently for any principal authorized to read the
    // object, so there's nothing to specify here.
    const command = new GetObjectCommand({ Bucket: process.env.DOCUMENT_VAULT_BUCKET!, Key: objectKey });
    const url = await getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
    return { url, simulated: false, expiresInSeconds: SIGNED_URL_EXPIRY_SECONDS, expiresAtIso };
  } catch (err) {
    console.error(`S3 signed URL generation failed for key ${objectKey}:`, err instanceof Error ? err.message : err);
    throw err;
  }
}
