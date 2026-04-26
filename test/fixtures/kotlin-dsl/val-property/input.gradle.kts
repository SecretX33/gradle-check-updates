val kotlinVersion = "1.9.0"
val springVersion by extra("3.2.0")
extra["guavaVersion"] = "32.1.3"

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:${kotlinVersion}")
    implementation("org.springframework:spring-core:${springVersion}")
    implementation("com.google.guava:guava:${guavaVersion}")
}
