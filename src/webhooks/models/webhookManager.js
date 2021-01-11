'use strict';
const databaseConnector = require('./database/sequelize/sequelizeConnector');
const { ERROR_MESSAGES, CONTEXT_ID } = require('../../common/consts');
const generateError = require('../../common/generateError');
const requestSender = require('../../common/requestSender');
const logger = require('../../common/logger');
const webhooksFormatter = require('./webhooksFormatter');

const webhookDefaultValues = {
    global: false
};

async function getAllWebhooks(context) {
    const contextId = context.get(CONTEXT_ID);

    return await databaseConnector.getAllWebhooks(contextId);
}

async function getWebhook(webhookId, context) {
    const contextId = context.get(CONTEXT_ID);

    const webhook = await databaseConnector.getWebhook(webhookId, contextId);
    if (!webhook) {
        throw generateError(404, ERROR_MESSAGES.NOT_FOUND);
    }
    return webhook;
}

async function createWebhook(webhookInfo, context) {
    const contextId = context.get(CONTEXT_ID);

    const webhook = {
        ...webhookDefaultValues,
        ...webhookInfo
    };
    return databaseConnector.createWebhook(webhook, contextId);
}

async function deleteWebhook(webhookId, context) {
    const contextId = context.get(CONTEXT_ID);

    const webhook = await databaseConnector.getWebhook(webhookId, contextId);
    if (!webhook) {
        throw generateError(404, ERROR_MESSAGES.NOT_FOUND);
    }

    return databaseConnector.deleteWebhook(webhookId, contextId);
}

async function updateWebhook(webhookId, webhook) {
    const webhookInDB = await getWebhook(webhookId);
    if (!webhookInDB) {
        throw generateError(404, ERROR_MESSAGES.NOT_FOUND);
    }
    return databaseConnector.updateWebhook(webhookId, webhook);
}

async function getAllGlobalWebhooks(context) {
    const contextId = context.get(CONTEXT_ID);

    return databaseConnector.getAllGlobalWebhooks(contextId);
}

async function fireSingleWebhook(webhook, payload) {
    try {
        const response = await requestSender.send({
            method: 'POST',
            url: webhook.url,
            body: payload,
            resolveWithFullResponse: true
        });
        logger.info(`Webhook fired successfully, url = ${webhook.url}`);
        return response;
    } catch (requestError) {
        logger.error(`Webhook failed, url = ${webhook.url}`);
        throw requestError;
    }
}

function fireWebhooksPromisesArray(webhooks, eventType, jobId, testId, report, additionalInfo, options, context) {
    return webhooks.map(webhook => {
        const webhookPayload = webhooksFormatter.format(webhook.format_type, eventType, jobId, testId, report, additionalInfo, options, context);
        return fireSingleWebhook(webhook, webhookPayload);
    });
}

async function fireWebhookByEvent(job, eventType, report, additionalInfo = {}, options = {}, context) {
    const jobWebhooks = job.webhooks ? await Promise.all(job.webhooks.map(webhookId => getWebhook(webhookId))) : [];
    const globalWebhooks = await getAllGlobalWebhooks(context);
    const webhooks = [...jobWebhooks, ...globalWebhooks];
    const webhooksWithEventType = webhooks.filter(webhook => webhook.events.includes(eventType));
    if (webhooksWithEventType.length === 0) {
        return;
    }
    const webhooksPromises = fireWebhooksPromisesArray(webhooksWithEventType, eventType, job.id, job.test_id, report, additionalInfo, options, context);
    await Promise.allSettled(webhooksPromises);
}

async function testWebhook(webhook) {
    const payload = webhooksFormatter.formatSimpleMessage(webhook.format_type);
    let webhookStatusCode;
    try {
        const response = await fireSingleWebhook(webhook, payload);
        webhookStatusCode = response.statusCode;
    } catch (requestError) {
        webhookStatusCode = requestError.statusCode || requestError.message;
    }
    return {
        webhook_status_code: webhookStatusCode,
        is_successful: webhookStatusCode >= 200 && webhookStatusCode <= 207
    };
}

module.exports = {
    getAllWebhooks,
    getWebhook,
    createWebhook,
    deleteWebhook,
    updateWebhook,
    testWebhook,
    fireWebhookByEvent
};
