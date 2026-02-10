import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { LoggerService } from '../logs/logger.service';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';

interface JwtHeader {
  kid?: string;
  [key: string]: unknown;
}

interface RequestWithUser extends Request {
  user?: string | jwt.JwtPayload;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private client: jwksClient.JwksClient | null = null;
  private readonly supabaseJwtAudience: string;
  private readonly supabaseJwtIssuer: string;

  constructor(@Inject(LoggerService) private readonly logger: LoggerService) {
    this.supabaseJwtAudience =
      process.env.SUPABASE_JWT_AUDIENCE || 'authenticated';
    this.supabaseJwtIssuer =
      process.env.SUPABASE_JWT_ISSUER ||
      'https://<your-project-id>.supabase.co/auth/v1';
  }

  private getJwksClient(): jwksClient.JwksClient {
    if (!this.client) {
      const jwksUri = `${this.supabaseJwtIssuer}/.well-known/jwks.json`;
      this.client = jwksClient.default({ jwksUri });
      this.logger.log(`Initialized JWKS client with URI: ${jwksUri}`);
    }
    return this.client;
  }

  private getKey(
    header: JwtHeader,
    callback: (err: Error | null, signingKey?: string) => void,
  ): void {
    const kid = header.kid;
    if (!kid) {
      callback(new Error('Missing kid in token header'));
      return;
    }

    const client = this.getJwksClient();
    client.getSigningKey(kid, function (err, key) {
      if (err) {
        callback(err);
        return;
      }
      const signingKey = key?.getPublicKey();
      callback(null, signingKey);
    });
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.error(
        `Unauthorized access attempt: Missing or invalid Authorization header`,
        `request.url: ${request.url}`,
      );
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }
    const token = authHeader.split(' ')[1];

    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        this.getKey.bind(this) as unknown as jwt.Secret,
        {
          audience: this.supabaseJwtAudience,
          issuer: this.supabaseJwtIssuer,
          algorithms: ['ES256'],
        },
        (err, decoded) => {
          if (err) {
            this.logger.error(
              `Unauthorized access attempt: Invalid token`,
              `request.url: ${request.url}`,
            );
            reject(new UnauthorizedException('Invalid token'));
          } else {
            // Attach user info to request for later use
            request.user = decoded;
            resolve(true);
          }
        },
      );
    });
  }
}
