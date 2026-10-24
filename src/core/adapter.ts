export type StackId = "expo";

export type StackDetection = { stack: StackId };

export interface StackAdapter {
  id: StackId;
  detect(projectDir: string): Promise<StackDetection | undefined>;
}
