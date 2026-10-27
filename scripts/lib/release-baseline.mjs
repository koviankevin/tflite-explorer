// The last verified root-only deployment. These pins authorize retaining that
// exact legacy release, never relaxing the gate policy for a new candidate.
export const SITE_BASELINE=Object.freeze({version:'0.2.0-preview.7',build:'163f38ab1dc856e4',source:'a0c0f702e310b53fc6baa3a05a57dbb5ca79b887',sha256:'4a7db3bcf310d7253c1d103cf86292323c32441b7471e84c035917a66b0702f7',bytes:29454029});
export const BASELINE_MANIFEST_SHA256='856da197840ba33d498317d07e22b223c20bac0d84984b226a82cece189b4a54';
export const LEGACY_DELIVERY=Object.freeze({source:SITE_BASELINE.source,build:SITE_BASELINE.build,manifest:BASELINE_MANIFEST_SHA256,receipt:'1cd1083d2b6919fcb40c9b39e5ca1f477459fe6d37c31a2c6aaae978f31e769a',zip:SITE_BASELINE.sha256});
