export type Attachment = {
  name: string;
  url: string;
  kind: "image" | "audio" | "video" | "file";
  size: number;
};
export type LocalMessage = {
  id: string;
  text: string;
  time: string;
  attachment?: Attachment;
};
