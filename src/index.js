'use strict';

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const mongoBackup = require('mongodb-backup');
const child_process = require('child_process');
const readdir = require('recursive-readdir');
const Q = require('q');
const simpleGit = require('simple-git');


const uri = yargs.argv.uri || process.env.uri;
const git = yargs.argv.git || process.env.git;
let dir = yargs.argv.dir || process.env.dir;
let cron = process.env.cron || yargs.argv.cron;
let timezone = yargs.argv.timezone || process.env.timezone || 'Australia/Melbourne';
let runDf;

init();

function init() {
  dir = path.resolve(__dirname, dir);
  log('Backing up MongoDB to directory:', dir);
  if (!uri) {
    throw new Error('No MongoDB URI provided');
  }
  console.log(`Parsed URI: ${uri}`);

  gitInit();
  run();
  initCron();
}

function initCron() {
  const CronJob = require('cron').CronJob;
  // Run every hour by default.
  const cronRange = cron || '00 00 * * * *';
  const job = new CronJob(cronRange, run,
    true, /* Start the job right now */
    timezone
  );
}

function gitInit(d, g) {
  log('Git clone...');
  // const USER = 'something';
  // const PASS = 'somewhere';
  // const REPO = 'github.com/username/private-repo';
  // const remote = `https://${USER}:${PASS}@${REPO}`;

  runDf = Q.defer();
  runDf.resolve(
    deleteFiles(dir)
    .then(simpleGit(`${dir}/`)
      .clone(git))
  );
}

function run() {
  if (runDf && runDf.promise && Q.isPending(runDf.promise)) return;

  runDf = Q.defer();
  runDf.resolve(deleteFiles(dir).then(backup).then(push));
  runDf.promise.catch(function (err) {
    console.error(err, err.stack);
  }).done();
}

function backup() {
  log('Backing up data...');
  const df = Q.defer();
  mongoBackup({
    uri: uri,
    root: dir,
    callback: (err, result) => {
      if (err) {
        // log('Error during backup', err);
        console.log(err);
        df.reject(err);
      } else {
        log('Backup successful', result);
        df.resolve(result);
      }
    }
  });
  return df.promise;
}

function push() {
  log(`Adding to Git: ${dir}/*`);
  const df = Q.defer();

  function callback(err, result) {
    if (err) df.reject(err);
  }

  simpleGit(`${dir}/*`)
    .add(dir, callback)
    .then(function () {
      log('Committing...');
    })
    .commit('Update', callback)
    .then(function () {
      log('Pushing...');
    })
    .push('origin', 'master', callback)
    .then(function () {
      log('Pushed to Git');
      df.resolve();
    });
  return df.promise;
}

function deleteFiles(dir) {
  log('Deleting existing files...');
  const df = Q.defer();

  // Exclude hidden directories (e.g. git). 
  // const dbDir = path.join(dir, '/*');
  log('Deleting directory:', dir);

  return Q.ninvoke(child_process, 'exec', `rm -rf ${dir}/*`, {});
}

function log() {
  const args = Array.prototype.slice.call(arguments);
  args.unshift(new Date());
  console.log.call(console, args.join(' '));
}