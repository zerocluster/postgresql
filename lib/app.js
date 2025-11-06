import App from "#core/app";
import { chmod } from "#core/fs";

export default class extends App {

    // propeties
    get location () {
        return import.meta.url;
    }

    // protected
    // FIX: https://github.com/docker/cli/issues/6630
    async _configure () {
        await chmod( "/dev/shm", 0o1777 );

        return super._configure();
    }
}
