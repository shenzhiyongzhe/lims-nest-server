import { IsArray, ArrayMinSize } from 'class-validator';

export class CreateShareLinkDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'ids数组不能为空' })
  ids: number[];
}
