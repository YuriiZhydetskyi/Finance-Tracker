/**
 * Finance Tracker: automatic receipt import from one Gmail label.
 *
 * Runs in YOUR Google account, as a project you create at script.google.com.
 * It reads only the messages under GMAIL_LABEL and posts each new one to your
 * Finance Tracker ingest endpoint, authenticated with your personal token.
 * The Gmail permission it asks for is read-only, and it never leaves Google.
 *
 * Nothing here is secret. The endpoint and the token live in Script properties
 * (Project Settings -> Script properties), never in this file:
 *   INGEST_URL    https://<project-ref>.supabase.co/functions/v1/ingest-email-receipts
 *   INGEST_TOKEN  fte_... (created on the «Масовий імпорт» page of Finance Tracker)
 *   GMAIL_LABEL   the label to read, «Різні чеки» when not set
 *   START_DATE    optional YYYY-MM-DD; older messages are never sent
 *
 * Run install() once: it asks for the permissions, creates an hourly trigger
 * and performs the first sync. uninstall() removes the trigger.
 */

var MAX_MESSAGES_PER_RUN = 20;
var MAX_LISTED_MESSAGES = 200;
var INGEST_URL_PATTERN =
  /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/ingest-email-receipts$/;
var TOKEN_PATTERN = /^fte_[A-Za-z0-9_-]{43}$/;

function syncReceipts() {
  var config = readConfig_();
  var labelId = findLabelId_(config.label);
  var ids = listMessageIds_(labelId, config.startDate);
  if (ids.length === 0) return;

  var wanted = callIngest_(config, { op: 'pending', message_ids: ids }).wanted || [];
  var batch = wanted.slice(0, MAX_MESSAGES_PER_RUN);
  for (var index = 0; index < batch.length; index += 1) {
    var id = batch[index];
    var message = Gmail.Users.Messages.get('me', id, { format: 'raw' });
    // The advanced service returns `raw` already decoded into bytes.
    var raw =
      typeof message.raw === 'string' ? message.raw : Utilities.base64EncodeWebSafe(message.raw);
    try {
      var result = callIngest_(config, {
        op: 'ingest',
        message_id: id,
        internal_date: Number(message.internalDate),
        raw: raw,
      });
      console.log(id + ': ' + result.status + (result.reason ? ' (' + result.reason + ')' : ''));
    } catch (error) {
      if (error.status === 429) {
        console.warn('Daily import limit reached; the rest waits for the next run.');
        return;
      }
      console.error(id + ': ' + error.message);
    }
  }
  if (wanted.length > batch.length) {
    console.log(String(wanted.length - batch.length) + ' more message(s) wait for the next run.');
  }
}

function install() {
  readConfig_();
  uninstall();
  ScriptApp.newTrigger('syncReceipts').timeBased().everyHours(1).create();
  syncReceipts();
}

function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncReceipts') ScriptApp.deleteTrigger(trigger);
  });
}

function readConfig_() {
  var properties = PropertiesService.getScriptProperties();
  var url = (properties.getProperty('INGEST_URL') || '').trim();
  var token = (properties.getProperty('INGEST_TOKEN') || '').trim();
  var startDate = (properties.getProperty('START_DATE') || '').trim();
  if (!INGEST_URL_PATTERN.test(url)) {
    throw new Error(
      'INGEST_URL must be https://<project-ref>.supabase.co/functions/v1/ingest-email-receipts',
    );
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('INGEST_TOKEN is missing or malformed. Create one in Finance Tracker.');
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('START_DATE must look like 2026-10-26.');
  }
  return {
    url: url,
    token: token,
    label: (properties.getProperty('GMAIL_LABEL') || 'Різні чеки').trim(),
    startDate: startDate,
  };
}

function findLabelId_(name) {
  var labels = Gmail.Users.Labels.list('me').labels || [];
  for (var index = 0; index < labels.length; index += 1) {
    if (labels[index].name === name) return labels[index].id;
  }
  throw new Error('Gmail label not found: ' + name);
}

function listMessageIds_(labelId, startDate) {
  var ids = [];
  var pageToken;
  do {
    var options = { labelIds: [labelId], maxResults: 100 };
    if (startDate) options.q = 'after:' + startDate.replace(/-/g, '/');
    if (pageToken) options.pageToken = pageToken;
    var page = Gmail.Users.Messages.list('me', options);
    (page.messages || []).forEach(function (message) {
      ids.push(message.id);
    });
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_LISTED_MESSAGES);
  return ids.slice(0, MAX_LISTED_MESSAGES);
}

function callIngest_(config, body) {
  var response = UrlFetchApp.fetch(config.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + config.token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    followRedirects: false,
  });
  var status = response.getResponseCode();
  if (status !== 200) {
    var error = new Error(
      'Finance Tracker answered ' + status + ': ' + response.getContentText().slice(0, 200),
    );
    error.status = status;
    throw error;
  }
  return JSON.parse(response.getContentText());
}
