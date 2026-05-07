/* istanbul ignore file */
import { ClientProvider, Transport } from '@nestjs/microservices';
import { CompressionTypes } from '@nestjs/microservices/external/kafka.interface';
import { logLevel } from 'kafkajs';
import { AppConfigService } from 'src/shared/config/config.service';

export const KAFKA_CLIENT = 'KAFKA_DEFAULT_CLIENT';

export function getKafkaConfigs(configs: AppConfigService): ClientProvider {
  const mechanism = configs.kafkaDefaultMechanism;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sasl: any = undefined;

  if (mechanism && mechanism !== 'NONE') {
    sasl = {
      mechanism: mechanism,
      username: configs.kafkaDefaultUsername,
      password: configs.kafkaDefaultPassword,
    };
  }

  return {
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: configs.kafkaDefaultClientId,
        brokers: [configs.kafkaDefaultBrokerUrl],
        ssl: configs.kafkaDefaultSsl,
        sasl: sasl,
        requestTimeout: configs.kafkaDefaultRequestTimeout,
        enforceRequestTimeout: true,
        logLevel: getLogLevel(configs),
      },
      consumer: {
        groupId: configs.kafkaDefaultGroupId,
        allowAutoTopicCreation: configs.kafkaDefaultAutoCreateTopic,
      },
      send: {
        timeout: configs.kafkaDefaultRequestTimeout,
        compression: CompressionTypes.GZIP,
      },
      run: {
        partitionsConsumedConcurrently: configs.kafkaDefaultConcurrently,
      },
    },
  };
}

export function configKafkaEventFactory(configs: AppConfigService): ClientProvider {
  return {
    ...getKafkaConfigs(configs),
  } as ClientProvider;
}

function getLogLevel(configService: AppConfigService): logLevel {
  if (configService.nodeEnv === 'production' || configService.nodeEnv === 'staging') {
    return logLevel.WARN;
  }

  return logLevel.INFO;
}
