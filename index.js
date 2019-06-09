#!/usr/bin/env node

const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const s3 = require('s3');
const axios = require('axios')

async function buildAndLoadPath() {
  console.log('Building release binary')
  await new Promise((rs, rj) => exec(`
    set -e
    test -d android || (echo "Unable to find android dir, run for rn project root" && exit 1)
    cd android
    ./gradlew assembleRelease
    `, (err, stdout, stderr) => {
      if (err) return rj(err)
      rs(stdout)
    }))
  return path.join(process.cwd(), 'android/app/build/outputs/apk/release/app-release.apk')
}

async function uploadApk(localFile, uploadOptions = {}, s3Options = {}) {
  const filename = `${+new Date()}.apk`
  const client = s3.createClient({
    s3Options: {
      s3BucketEndpoint: !!s3Options.endpoint,
      ...s3Options
    }
  })
  await new Promise((rs, rj) => client.uploadFile({
    localFile,
    s3Params: uploadOptions,
  }).on('end', () => {
    console.log('APK uploaded')
    rs()
  }).on('error', (err) => {
    console.log('Error uploading', err)
    process.exit(1)
  }))
  return path.join(s3Options.endpoint, filename)
}

async function postComment(options = {}) {
  await axios.get(`https://pthrower.jchancehud.now.sh`, {
    params: options
  })
}

(async () => {
  try {
    const apkPath = await buildAndLoadPath()
    if (!fs.existsSync(apkPath)) {
      throw new Error('Unable to find built apk')
    }
    const {
      PTHROW_ACCESS_ID: accessKeyId,
      PTHROW_ACCESS_SECRET: secretAccessKey,
      PTHROW_SPACE_ENDPOINT: endpoint,
      TRAVIS_PULL_REQUEST: pullNumber,
      TRAVIS_REPO_SLUG: repoSlug,
      PTHROW_BUCKET: bucket,
      TRAVIS_BUILD_NUMBER: buildNumber,
    } = process.env
    const Key = `${repoSlug}-${pullNumber}-${buildNumber}.apk`
    const apkUrl = await uploadApk(apkPath, {
      Key,
      Bucket: bucket,
      ACL: 'public-read',
    }, {
      accessKeyId,
      secretAccessKey,
      endpoint,
    })
    if (!pullNumber) return // Not a PR build
    await postComment({
      pullNumber,
      repoSlug,
      apkUrl,
    })
  } catch (err) {
    console.log('Uncaught error', err)
    process.exit(1)
  }
})()
