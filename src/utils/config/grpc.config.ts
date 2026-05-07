import { GrpcOptions, Transport } from '@nestjs/microservices';
import * as path from 'path';
import * as fs from 'fs';
import { AppConfigService } from 'src/shared/config/config.service';

export function getGRPCConfigs(configs: AppConfigService): GrpcOptions {
  const protoFiles = getModulesProtoFiles();

  return {
    transport: Transport.GRPC,
    options: {
      package: protoFiles.map((file) => file.package),
      protoPath: protoFiles.map((file) => file.protoPath),
      url: `${configs.grpcUrl}:${configs.grpcPort}`,
      loader: { keepCase: true },
      maxSendMessageLength: 1024 * 1024 * +configs.maxSendSizeInMb,
      maxReceiveMessageLength: 1024 * 1024 * +configs.maxReceiveSizeInMb,
      keepalive: {
        // Send keepalive pings every 60 seconds, default is 2 hours (7200 seconds).
        keepaliveTimeMs: 60 * 1000,
        // Keepalive ping timeout after 50 seconds, default is 20 seconds.
        keepaliveTimeoutMs: 50 * 1000,
        // Allow keepalive pings when there are no gRPC calls.
        keepalivePermitWithoutCalls: 1,
      },
    },
  };
}

function getModulesProtoFiles(): { package: string; protoPath: string }[] {
  const modulesDir = path.join(__dirname, '../../modules');
  const modules = fs.readdirSync(modulesDir).filter((file) => fs.statSync(path.join(modulesDir, file)).isDirectory());
  const protoFiles: { package: string; protoPath: string }[] = [];

  modules.forEach((module) => {
    const moduleDir = path.join(modulesDir, module, 'protos');
    if (fs.existsSync(moduleDir)) {
      const files = getProtoFiles(moduleDir);
      protoFiles.push(...files);
    }
  });

  return protoFiles;
}

function getProtoFiles(dir: string, fileList: { package: string; protoPath: string }[] = []): { package: string; protoPath: string }[] {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    if (fs.statSync(path.join(dir, file)).isDirectory()) {
      fileList = getProtoFiles(path.join(dir, file), fileList);
    } else {
      // Add only proto files to list.
      if (path.extname(file) === '.proto') {
        const packageName = getProtoPackageName(path.join(dir, file));
        fileList.push({
          package: packageName,
          protoPath: path.join(dir, file),
        });
      }
    }
  });

  return fileList;
}

function getProtoPackageName(protoPath: string): string {
  const protoFile = fs.readFileSync(protoPath, 'utf-8');
  const match = protoFile.match(/package\s+([a-zA-Z0-9_.]+)/);
  return match ? (match[1] ?? '') : '';
}
