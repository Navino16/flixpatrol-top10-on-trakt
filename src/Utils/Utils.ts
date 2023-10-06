export class Utils {
  public static sleep(time: number) {
    return new Promise((resolve) => { setTimeout(resolve, time); });
  }
}
