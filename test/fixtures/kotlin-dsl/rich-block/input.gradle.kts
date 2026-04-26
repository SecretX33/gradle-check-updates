dependencies {
    implementation("org.foo:bar") {
        version {
            strictly("1.7.15")
            prefer("1.7.25")
        }
    }
}
