val kotlinVersion = "2.0.21"
val springVersion by extra("3.2.5")
extra["guavaVersion"] = "33.0.0"

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:${kotlinVersion}")
    implementation("org.springframework:spring-core:${springVersion}")
    implementation("com.google.guava:guava:${guavaVersion}")
}
