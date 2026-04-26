import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
}

group = "com.example.content.api"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    implementation(project(":app:common"))
    implementation(project(":app:content:m1-data"))
    implementation(project(":app:content:m2-services"))

    // Spring Boot & JPA
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.data.commons)

    // Kotlin
    implementation(libs.bundles.kotlin.core)

    // Google maps
    implementation(libs.bundles.google.maps)
    implementation(libs.libphonenumber)

    implementation(libs.commons.csv)
    implementation(libs.commons.lang3)

    // SFTP client
    implementation(libs.jsch)

    // Test dependencies
    testRuntimeOnly(libs.h2)
    testImplementation(testFixtures(project(":app:content:m1-data")))
    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.springmockk)
    testImplementation(libs.assertj.core)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.reactor.test)
    testImplementation(libs.bucket4j)

    // OSV test dependencies
    testImplementation(libs.xmlunit.core)
}

tasks.jar {
    enabled = true
    archiveBaseName.set("content-api")
    archiveClassifier.set("")

    // Optimize Jar creation
    duplicatesStrategy = DuplicatesStrategy.WARN

    // Enable caching for Jar tasks
    outputs.cacheIf { true }
}

tasks.bootJar {
    enabled = false
}

// Optimize build cache for this module
tasks.withType<JavaCompile>().configureEach {
    options.isFork = true
    options.isIncremental = true

    // Enable caching for Java compilation
    outputs.cacheIf { true }
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        // Update JVM target to 21
        jvmTarget.set(JvmTarget.JVM_21)
    }

    // Enable caching for Kotlin compilation
    outputs.cacheIf { true }
}
