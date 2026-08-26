/** Host-owned document location passed to editor commands. */
export interface DocumentPosition {
  uri: string;
  fileName: string;
  line: number;
  character: number;
  label: string;
}

/** Local editor capabilities supplied to the VIR infoview. */
export interface InfoviewCommandHost {
  documentPosition(
    uri: string,
    fileName: string,
    line: number,
    character: number,
    label: string,
  ): DocumentPosition;
  revealPosition(position: DocumentPosition): boolean;
  insertText(position: DocumentPosition, text: string): boolean;
}
