import Piscina from '@crcastle/fastify-piscina';
import { MessageChannel } from 'worker_threads';
import { FastifyInstance } from 'fastify';
import { resolve } from 'path';
import RequestBodySchema from '../../schemas/pdf/requestBody.json';
import { RequestBodySchema as RequestBodySchemaInterface } from '../../types/pdf/requestBody';

/**
 * Dynamically create a car order confirmation PDF using information provided
 * by the customer's selected configuration and their Salesforce account data.
 * Then save that PDF to Salesforce and link it to the Lead record.
 */
export default async function (fastify: FastifyInstance, opts: any) {
    opts.schema = { body: RequestBodySchema };

    fastify.register(Piscina, {
        // Piscina Options object. See Piscina docs for details
        filename: resolve(__dirname, 'worker'),
        maxThreads: 1,
        maxQueue: 0
    });

    fastify.post<{
        Body: RequestBodySchemaInterface;
    }>('/', opts, async function (request, reply) {
        // Handle logging from worker thread
        const {
            port1: workerThreadPort,
            port2: mainThreadPort
        } = new MessageChannel();
        mainThreadPort.on('message', (logMessage) => {
            const { level, text } = logMessage;
            request.log[level](text);
        });

        const { body: data } = request;

        // If no PDF currently being generated, generate a PDF
        // If PDF currently being generated, return error saying please try again later
        let response;
        try {
            response = await fastify.runTask({ data, workerThreadPort }, [
                workerThreadPort
            ]);
        } catch (err) {
            // TODO: The catch is overly broad. We only want to catch errors with message
            //  "No task queue available and all Workers are busy" but I'm hesitant to hard-code
            //  this string in the catch block. Unfortunately, the Error doesn't include a "code" property.
            //  https://nodejs.org/api/errors.html#errors_error_code
            request.log.warn(err.message);
            reply.code(503);
            reply.send({
                error: 'Service (temporarily) Unavailable',
                message:
                    'A PDF is currently being generated by another request or an error occurred. Please try again later.',
                statusCode: 503
            });
        }

        return response;
    });
}
