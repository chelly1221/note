import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const privateDir = path.join(root, '.local');
const settingsPath = path.join(privateDir, 'android-signing.json');
const keyPath = path.join(privateDir, 'note-release.jks');
const javaHome = process.env.JAVA_HOME;
if (!javaHome) throw new Error('Set JAVA_HOME to JDK 21 or newer.');
fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
let signing;
if (fs.existsSync(settingsPath))
  signing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
else {
  if (fs.existsSync(keyPath))
    throw new Error(
      'An existing signing key has no settings. Recover its settings before building.',
    );
  signing = {
    alias: 'note',
    password: randomBytes(32).toString('base64url'),
  };
  fs.writeFileSync(settingsPath, JSON.stringify(signing), {
    mode: 0o600,
    flag: 'wx',
  });
  const generated = spawnSync(
    path.join(
      javaHome,
      'bin',
      process.platform === 'win32' ? 'keytool.exe' : 'keytool',
    ),
    [
      '-genkeypair',
      '-v',
      '-keystore',
      keyPath,
      '-storetype',
      'JKS',
      '-alias',
      signing.alias,
      '-keyalg',
      'RSA',
      '-keysize',
      '3072',
      '-validity',
      '10000',
      '-dname',
      'CN=Note, OU=Personal Notes',
      '-storepass:env',
      'NOTE_SIGNING_PASSWORD',
      '-keypass:env',
      'NOTE_SIGNING_PASSWORD',
    ],
    {
      env: { ...process.env, NOTE_SIGNING_PASSWORD: signing.password },
      stdio: 'inherit',
    },
  );
  if (generated.status !== 0)
    throw new Error(
      'Signing key generation failed. Preserve the private settings for recovery.',
    );
}
if (!fs.existsSync(keyPath))
  throw new Error(
    'Restore the original signing key before building an update.',
  );
const build = spawnSync(
  process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
  ['assembleRelease'],
  {
    cwd: path.join(root, 'android'),
    shell: process.platform === 'win32',
    stdio: 'inherit',
    env: {
      ...process.env,
      NOTE_KEYSTORE: keyPath,
      NOTE_KEY_ALIAS: signing.alias,
      NOTE_KEY_PASSWORD: signing.password,
    },
  },
);
if (build.status !== 0) process.exit(build.status || 1);
const releases = path.join(root, 'releases');
fs.mkdirSync(releases, { recursive: true });
fs.copyFileSync(
  path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'),
  path.join(releases, 'note-0.1.0.apk'),
);
console.log(
  'Signed Android APK: releases/note-0.1.0.apk. Keep .local signing files for future updates.',
);
