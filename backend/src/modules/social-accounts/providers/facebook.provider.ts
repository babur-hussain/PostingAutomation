import { Injectable, Logger } from '@nestjs/common';
import { MetaProvider } from './meta.provider';

@Injectable()
export class FacebookProvider {
  private readonly logger = new Logger(FacebookProvider.name);

  // Facebook Pages specific requested scopes
  static readonly SCOPES = [
    'pages_manage_posts',
    'pages_show_list',
    'pages_read_engagement',
  ];

  constructor(private metaProvider: MetaProvider) {}

  getAuthorizationUrl(state: string): string {
    return this.metaProvider.getAuthorizationUrl(
      FacebookProvider.SCOPES,
      state,
    );
  }
}
