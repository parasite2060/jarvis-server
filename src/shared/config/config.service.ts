import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeEnvironment, RuntimeEnvironment } from './environment';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  // Server config
  get host(): string {
    return this.configService.getOrThrow<string>('HOST');
  }

  get port(): number {
    return this.configService.get<number>('PORT', 3000);
  }

  get nodeEnv(): NodeEnvironment {
    return this.configService.get<NodeEnvironment>('NODE_ENV', NodeEnvironment.DEVELOPMENT);
  }

  // GRPC config
  get grpcUrl(): string {
    return this.configService.get<string>('GRPC_URL', 'localhost');
  }

  get grpcPort(): number {
    return this.configService.get<number>('GRPC_PORT', 5000);
  }

  get maxSendSizeInMb(): number {
    return this.configService.get<number>('MAX_SEND_SIZE_IN_MB', 4);
  }

  get maxReceiveSizeInMb(): number {
    return this.configService.get<number>('MAX_RECEIVE_SIZE_IN_MB', 4);
  }

  // Environment config
  get runtimeEnv(): RuntimeEnvironment {
    return this.configService.getOrThrow<RuntimeEnvironment>('RUNTIME_ENV');
  }

  // Redis config
  get redisHost(): string {
    return this.configService.getOrThrow<string>('REDIS_HOST');
  }

  get redisPort(): number {
    return this.configService.get<number>('REDIS_PORT', 6379);
  }

  get redisPass(): string {
    return this.configService.get<string>('REDIS_PASS', '');
  }

  get redisDb(): number {
    return this.configService.get<number>('REDIS_DB', 0);
  }

  // MongoDB config
  get mongodbUri(): string {
    return this.configService.getOrThrow<string>('MONGODB_URI');
  }

  get mongodbRetryAttempts(): number {
    return this.configService.getOrThrow<number>('MONGODB_RETRY_ATTEMPTS');
  }

  get mongodbRetryDelay(): number {
    return this.configService.getOrThrow<number>('MONGODB_RETRY_DELAY');
  }

  get mongodbConnectTimeout(): number {
    return this.configService.getOrThrow<number>('MONGODB_CONNECT_TIMEOUT');
  }

  get mongodbTimeout(): number {
    return this.configService.getOrThrow<number>('MONGODB_TIMEOUT');
  }

  // Postgres config
  get databaseHost(): string {
    return this.configService.getOrThrow<string>('DATABASE_HOST');
  }

  get databasePort(): number {
    return this.configService.getOrThrow<number>('DATABASE_PORT');
  }

  get databaseUser(): string {
    return this.configService.getOrThrow<string>('DATABASE_USER');
  }

  get databasePassword(): string {
    return this.configService.getOrThrow<string>('DATABASE_PASSWORD');
  }

  get databaseName(): string {
    return this.configService.getOrThrow<string>('DATABASE_NAME');
  }

  get databaseSchema(): string {
    return this.configService.getOrThrow<string>('DATABASE_SCHEMA');
  }

  get databaseSynchronize(): boolean {
    return this.configService.get<boolean>('DATABASE_SYNCHRONIZE', false);
  }

  get databasePoolSize(): number {
    return this.configService.get<number>('DATABASE_POOL_SIZE', 10);
  }

  // Kafka config
  get kafkaDefaultBrokerUrl(): string {
    return this.configService.getOrThrow<string>('KAFKA_DEFAULT_BROKER_URL');
  }

  get kafkaDefaultClientId(): string {
    return this.configService.getOrThrow<string>('KAFKA_DEFAULT_CLIENT_ID');
  }

  get kafkaDefaultGroupId(): string {
    return this.configService.getOrThrow<string>('KAFKA_DEFAULT_GROUP_ID');
  }

  get kafkaDefaultAutoCreateTopic(): boolean {
    return this.configService.get<boolean>('KAFKA_DEFAULT_AUTO_CREATE_TOPIC', false);
  }

  get kafkaDefaultSsl(): boolean {
    return this.configService.get<boolean>('KAFKA_DEFAULT_SSL', false);
  }

  get kafkaDefaultMechanism(): string {
    return this.configService.get<string>('KAFKA_DEFAULT_MECHANISM', '');
  }

  get kafkaDefaultUsername(): string {
    return this.configService.get<string>('KAFKA_DEFAULT_USERNAME', '');
  }

  get kafkaDefaultPassword(): string {
    return this.configService.get<string>('KAFKA_DEFAULT_PASSWORD', '');
  }

  get kafkaDefaultRequestTimeout(): number {
    return this.configService.get<number>('KAFKA_DEFAULT_REQUEST_TIMEOUT', 30000);
  }

  get kafkaDefaultConcurrently(): number {
    return this.configService.get<number>('KAFKA_DEFAULT_CONCURRENTLY', 1);
  }
}
