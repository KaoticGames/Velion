declare module '@3d-dice/dice-box' {
  interface DiceBoxOptions {
    assetPath?:       string;
    theme?:           string;
    gravity?:         number;
    mass?:            number;
    friction?:        number;
    restitution?:     number;
    angularDamping?:  number;
    linearDamping?:   number;
    spinForce?:       number;
    throwForce?:      number;
    startingHeight?:  number;
    settleTimeout?:   number;
    offscreen?:       boolean;
    scale?:           number;
    themeColor?:      string;
  }
  interface DiceResult {
    sides: number;
    value: number;
  }
  export default class DiceBox {
    constructor(container: string, options?: DiceBoxOptions);
    init(): Promise<void>;
    roll(notation: string): Promise<DiceResult[]>;
    clear(): void;
    onRollComplete: (results: DiceResult[]) => void;
  }
}