import { PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "./s3";

const policy = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { AWS: ["*"] },
    Action: ["s3:GetObject"],
    Resource: [`arn:aws:s3:::${BUCKET}/backgrounds/*`, `arn:aws:s3:::${BUCKET}/public/*`]
  }]
});

async function main() {
  await s3.send(new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: policy }));
  console.log(`Bucket policy set: public read on ${BUCKET}/backgrounds/* and ${BUCKET}/public/*`);
}

main().catch((err) => { console.error(err); process.exit(1); });
