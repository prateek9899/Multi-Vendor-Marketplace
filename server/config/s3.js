const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs/promises');
const path = require('path');

const hasS3Credentials = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const s3Client = hasS3Credentials
  ? new S3Client({
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })
  : null;

const BUCKET = process.env.AWS_S3_BUCKET || 'marketplace-uploads';
const localUploadPath = path.join(__dirname, '..', 'uploads');

// Upload image to S3 with optimization
const uploadToS3 = async (file, folder = 'products') => {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new Error('A valid image file is required.');
  }
  const safeFolder = folder === 'vendors/logos' ? folder : 'products';
  const optimizedBuffer = await sharp(file.buffer)
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const filename = `${uuidv4()}.jpg`;

  if (s3Client && process.env.AWS_S3_BUCKET) {
    const key = `${safeFolder}/${filename}`;
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: optimizedBuffer,
      ContentType: 'image/jpeg',
    });
    await s3Client.send(command);
    return {
      key,
      url: `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${key}`,
    };
  }

  const key = `local/${safeFolder}/${filename}`;
  const destination = path.join(localUploadPath, safeFolder, filename);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, optimizedBuffer, { flag: 'wx' });
  return { key, url: `/uploads/${safeFolder}/${filename}`, isLocal: true };
};

// Delete image from S3
const deleteFromS3 = async (key) => {
  if (key.startsWith('local/')) {
    const relativePath = key.slice('local/'.length);
    const resolvedPath = path.resolve(localUploadPath, relativePath);
    if (!resolvedPath.startsWith(`${path.resolve(localUploadPath)}${path.sep}`)) {
      throw new Error('Invalid local image key.');
    }
    await fs.rm(resolvedPath, { force: true });
    return;
  }
  if (!s3Client) throw new Error('S3 credentials are not configured for this image.');
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });
    await s3Client.send(command);
  } catch (error) {
    console.error('S3 Delete Error:', error.message);
    throw error;
  }
};

// Get a signed URL for private access
const getPresignedUrl = async (key, expiresIn = 3600) => {
  if (!s3Client) throw new Error('S3 credentials are not configured.');
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
};

module.exports = {
  uploadToS3,
  deleteFromS3,
  getPresignedUrl,
  s3Client,
};
