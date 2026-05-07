import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, LoggerService, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { Kafka, Producer, Consumer, Admin, logLevel } from 'kafkajs';

import { DBConnections } from '../../src/shared/postgres/utils/constaint';

import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/shared/config/config.service';
import { CustomLoggerService } from '../../src/shared/logger/services/custom-logger.service';
import { DefaultValidationOptions } from '../../src/utils/config/validation.config';
import {
  UnknownExceptionsFilter,
  DefaultInternalExceptionFilter,
  DefaultValidateExceptionFilter,
  DefaultUnauthorizedExceptionFilter,
  HttpExceptionFilter,
} from '../../src/utils/filter/exception.filter';
import { HttpRequestLoggingInterceptor } from '../../src/shared/logger/interceptors/http-request-logging.interceptor';
import { KafkaRequestLoggingInterceptor } from '../../src/shared/logger/interceptors/kafka-request-logging.interceptor';

/**
 * Creates a KafkaJS log creator that bridges KafkaJS logs to NestJS Logger
 * @param logger - NestJS Logger instance to use for logging
 * @returns KafkaJS logCreator function
 */
function createKafkaLogCreator(logger: LoggerService) {
  return () => {
    return ({ level, log }: { level: logLevel; log: any }) => {
      const { message, ...extra } = log;
      const extraStr = Object.keys(extra).length > 0 ? JSON.stringify(extra) : '';

      switch (level) {
        case logLevel.ERROR:
          logger.error(message, extraStr);
          break;
        case logLevel.WARN:
          logger.warn(message, extraStr);
          break;
        case logLevel.INFO:
          logger.log(message, extraStr);
          break;
        case logLevel.DEBUG:
          logger.debug?.(message, extraStr);
          break;
        default:
          logger.verbose?.(message, extraStr);
          break;
      }
    };
  };
}

export class E2ETestSetup {
  public app: INestApplication;
  public httpServer: any;
  public dataSource: DataSource;
  public mongoConnection: Connection;

  private kafka: Kafka;
  private kafkaProducer: Producer;
  private kafkaConsumer: Consumer;
  private kafkaAdmin: Admin;
  private receivedMessages: Map<string, any[]> = new Map();
  private isConsumerRunning = false;
  private testRunId: string;

  constructor() {
    this.testRunId = `e2e-${Date.now()}`;
  }

  async init(): Promise<void> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    this.app = moduleFixture.createNestApplication(undefined, {
      bufferLogs: true,
    });

    const { httpAdapter } = this.app.get(HttpAdapterHost);
    const cls = this.app.get(ClsService);
    const reflector = this.app.get(Reflector);
    const configService = this.app.get(AppConfigService);

    this.app.useLogger(this.app.get(CustomLoggerService));

    this.app.useGlobalInterceptors(new HttpRequestLoggingInterceptor(cls, reflector));
    this.app.useGlobalInterceptors(new KafkaRequestLoggingInterceptor(cls, reflector));

    this.app.useGlobalFilters(new UnknownExceptionsFilter(httpAdapter));
    this.app.useGlobalFilters(new DefaultValidateExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new DefaultInternalExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new DefaultUnauthorizedExceptionFilter(httpAdapter));
    this.app.useGlobalFilters(new HttpExceptionFilter(httpAdapter));

    this.app.useGlobalPipes(new ValidationPipe(DefaultValidationOptions));

    const uniqueGroupId = `${configService.kafkaDefaultGroupId}-${this.testRunId}`;
    this.app.connectMicroservice(
      {
        transport: Transport.KAFKA,
        options: {
          client: {
            clientId: configService.kafkaDefaultClientId,
            brokers: [configService.kafkaDefaultBrokerUrl],
          },
          consumer: {
            groupId: uniqueGroupId,
            allowAutoTopicCreation: true,
          },
          subscribe: { fromBeginning: false },
        },
      },
      { inheritAppConfig: true },
    );

    await this.app.startAllMicroservices();
    await this.app.init();

    this.httpServer = this.app.getHttpServer();
    this.dataSource = this.app.get(getDataSourceToken(DBConnections.INTERNAL));
    this.mongoConnection = this.app.get(getConnectionToken());

    await this.initKafkaTestClient(configService);
  }

  private async initKafkaTestClient(configService: AppConfigService): Promise<void> {
    const logger = new Logger('E2ETestSetup');

    this.kafka = new Kafka({
      clientId: `e2e-test-helper-${this.testRunId}`,
      brokers: [configService.kafkaDefaultBrokerUrl],
      logCreator: createKafkaLogCreator(logger),
    });

    this.kafkaProducer = this.kafka.producer();
    this.kafkaConsumer = this.kafka.consumer({
      groupId: `e2e-test-verifier-${this.testRunId}`,
    });
    this.kafkaAdmin = this.kafka.admin();

    await this.kafkaProducer.connect();
    await this.kafkaConsumer.connect();
    await this.kafkaAdmin.connect();
  }

  async cleanup(): Promise<void> {
    await new Promise((r) => setTimeout(r, 1000));

    const entities = this.dataSource.entityMetadatas;
    for (const entity of entities) {
      const repository = this.dataSource.getRepository(entity.name);
      await repository.query(`TRUNCATE TABLE "${entity.tableName}" RESTART IDENTITY CASCADE`);
    }

    const collections = await this.mongoConnection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }

    this.receivedMessages.clear();
  }

  async teardown(): Promise<void> {
    if (this.isConsumerRunning) {
      await this.kafkaConsumer.stop();
    }
    await this.kafkaConsumer.disconnect();
    await this.kafkaProducer.disconnect();
    await this.kafkaAdmin.disconnect();
    await this.app.close();
  }

  async ensureTopic(topic: string): Promise<void> {
    const topics = await this.kafkaAdmin.listTopics();
    if (!topics.includes(topic)) {
      await this.kafkaAdmin.createTopics({
        topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      });
    }
  }

  async subscribeToTopics(topics: string[]): Promise<void> {
    for (const topic of topics) {
      await this.ensureTopic(topic);
      this.receivedMessages.set(topic, []);
    }

    await this.kafkaConsumer.subscribe({ topics, fromBeginning: false });

    if (!this.isConsumerRunning) {
      await this.kafkaConsumer.run({
        eachMessage: async ({ topic, message }) => {
          const messages = this.receivedMessages.get(topic) || [];
          messages.push(JSON.parse(message.value?.toString() || '{}'));
          this.receivedMessages.set(topic, messages);
        },
      });
      this.isConsumerRunning = true;
    }
  }

  async subscribeToTopic(topic: string): Promise<void> {
    await this.subscribeToTopics([topic]);
  }

  async waitForMessage<T>(topic: string, predicate: (msg: T) => boolean, timeoutMs = 8000): Promise<T> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const messages = this.receivedMessages.get(topic) || [];
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 100));
    }

    const allMessages = this.receivedMessages.get(topic) || [];
    throw new Error(`Timeout waiting for message on topic "${topic}". ` + `Received ${allMessages.length} messages: ${JSON.stringify(allMessages)}`);
  }

  async publishTestEvent(topic: string, event: any): Promise<void> {
    await this.ensureTopic(topic);
    await this.kafkaProducer.send({
      topic,
      messages: [{ value: JSON.stringify(event) }],
    });
  }

  getMessages(topic: string): any[] {
    return this.receivedMessages.get(topic) || [];
  }

  clearMessages(topic?: string): void {
    if (topic) {
      this.receivedMessages.set(topic, []);
    } else {
      this.receivedMessages.clear();
    }
  }

  getRepository<T>(entity: new () => T) {
    return this.dataSource.getRepository(entity);
  }

  getMongoCollection(name: string) {
    return this.mongoConnection.db.collection(name);
  }
}
