import { PutBucketPolicyCommand } from "@aws-sdk/client-s3";
import { s3, PUBLIC_BUCKET } from "./s3";

const policy = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { AWS: ["*"] },
    Action: ["s3:GetObject"],
    Resource: [`arn:aws:s3:::${PUBLIC_BUCKET}/*`]
  }]
});

async function main() {
  await s3.send(new PutBucketPolicyCommand({ Bucket: PUBLIC_BUCKET, Policy: policy }));
  console.log(`Bucket policy set: public read on ${PUBLIC_BUCKET}/*`);
}

main().catch((err) => { console.error(err); process.exit(1); });
