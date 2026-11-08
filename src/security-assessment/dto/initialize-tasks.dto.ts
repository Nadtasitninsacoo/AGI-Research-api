
import { IsUUID } from 'class-validator';

export class InitializeTasksDto {
  @IsUUID('4')
  sessionKey!: string;
}
